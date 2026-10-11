use chrono::{DateTime, Utc};
use cron::Schedule;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderKind {
    Water,
    EyeRest,
    Break,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderLevel {
    /// 轻推:宠物只做个动作,不打断用户
    Gentle,
    /// 普通:气泡文字提醒
    Normal,
    /// 强提醒:弹窗 + 语音
    Strong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub name: String,
    pub kind: ReminderKind,
    /// cron 表达式,支持秒字段,例如 "0 */45 * * * *"
    pub cron_expr: String,
    pub message: String,
    pub level: ReminderLevel,
    pub enabled: bool,
}

impl Reminder {
    pub fn new(
        name: &str,
        kind: ReminderKind,
        cron_expr: &str,
        message: &str,
        level: ReminderLevel,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            kind,
            cron_expr: cron_expr.to_string(),
            message: message.to_string(),
            level,
            enabled: true,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        Schedule::from_str(&self.cron_expr)
            .map(|_| ())
            .map_err(|e| format!("cron 解析失败: {e}"))
    }
}

#[derive(Debug, Clone)]
pub struct ReminderEvent {
    pub reminder: Reminder,
    pub fired_at: DateTime<Utc>,
}

/// 提醒引擎:每个启用的提醒独占一个 tokio 任务,按 cron 计算下次触发时间。
/// 触发后通过 channel 发出 `ReminderEvent`,由 Tauri 层转发给前端宠物做动作/播报。
pub struct ReminderEngine {
    reminders: Arc<RwLock<HashMap<String, Reminder>>>,
    tasks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    tx: mpsc::UnboundedSender<ReminderEvent>,
}

impl ReminderEngine {
    pub fn new(tx: mpsc::UnboundedSender<ReminderEvent>) -> Self {
        Self {
            reminders: Arc::new(RwLock::new(HashMap::new())),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }

    pub async fn add(&self, reminder: Reminder) -> Result<String, String> {
        reminder.validate()?;
        let id = reminder.id.clone();
        self.reminders
            .write()
            .await
            .insert(id.clone(), reminder.clone());
        self.spawn(id.clone(), reminder).await;
        Ok(id)
    }

    pub async fn remove(&self, id: &str) -> bool {
        if let Some(h) = self.tasks.write().await.remove(id) {
            h.abort();
        }
        self.reminders.write().await.remove(id).is_some()
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> bool {
        let cloned = {
            let mut guard = self.reminders.write().await;
            match guard.get_mut(id) {
                Some(r) => {
                    r.enabled = enabled;
                    r.clone()
                }
                None => return false,
            }
        };
        if let Some(h) = self.tasks.write().await.remove(id) {
            h.abort();
        }
        if enabled {
            self.spawn(id.to_string(), cloned).await;
        }
        true
    }

    pub async fn list(&self) -> Vec<Reminder> {
        self.reminders.read().await.values().cloned().collect()
    }

    async fn spawn(&self, id: String, reminder: Reminder) {
        let tx = self.tx.clone();
        let handle = tokio::spawn(async move {
            let schedule = match Schedule::from_str(&reminder.cron_expr) {
                Ok(s) => s,
                Err(_) => return,
            };
            loop {
                let now = Utc::now();
                let next = match schedule.after(&now).next() {
                    Some(t) => t,
                    None => return,
                };
                let wait = next
                    .signed_duration_since(now)
                    .to_std()
                    .unwrap_or(std::time::Duration::from_secs(0));
                tokio::time::sleep(wait).await;
                let event = ReminderEvent {
                    reminder: reminder.clone(),
                    fired_at: Utc::now(),
                };
                if tx.send(event).is_err() {
                    return; // 接收端已关闭
                }
            }
        });
        self.tasks.write().await.insert(id, handle);
    }
}

/// 从中文自然语言创建提醒,例如:
/// - "每45分钟提醒我喝水"
/// - "每2小时提醒我站起来活动"
/// - "每20分钟提醒我看看远处"
pub fn parse_natural(input: &str, message: Option<&str>) -> Option<Reminder> {
    let minutes = Regex::new(r"每\s*(\d+)\s*分钟")
        .ok()?
        .captures(input)
        .and_then(|c| c[1].parse::<u32>().ok())
        .map(|n| (n, "minutes"));
    let hours = Regex::new(r"每\s*(\d+)\s*小时")
        .ok()?
        .captures(input)
        .and_then(|c| c[1].parse::<u32>().ok())
        .map(|n| (n, "hours"));
    let (n, unit) = minutes.or(hours)?;
    if n == 0 {
        return None;
    }
    let cron_expr = match unit {
        "minutes" => format!("0 */{n} * * * *"),
        _ => format!("0 0 */{n} * * *"),
    };
    let kind = if input.contains("喝水") || input.contains('水') {
        ReminderKind::Water
    } else if input.contains('眼') || input.contains("远眺") || input.contains("远处") {
        ReminderKind::EyeRest
    } else if input.contains("休息")
        || input.contains('站')
        || input.contains("活动")
        || input.contains('走')
    {
        ReminderKind::Break
    } else {
        ReminderKind::Custom
    };
    let default_msg = match kind {
        ReminderKind::Water => "该喝水啦",
        ReminderKind::EyeRest => "看看远处,放松一下眼睛",
        ReminderKind::Break => "起来活动一下吧",
        ReminderKind::Custom => "提醒时间到",
    };
    Some(Reminder::new(
        input,
        kind,
        &cron_expr,
        message.unwrap_or(default_msg),
        ReminderLevel::Normal,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_water() {
        let r = parse_natural("每45分钟提醒我喝水", None).unwrap();
        assert_eq!(r.kind, ReminderKind::Water);
        assert_eq!(r.cron_expr, "0 */45 * * * *");
        r.validate().unwrap();
    }

    #[test]
    fn natural_eye() {
        let r = parse_natural("每20分钟提醒我看看远处", None).unwrap();
        assert_eq!(r.kind, ReminderKind::EyeRest);
    }

    #[test]
    fn natural_invalid() {
        assert!(parse_natural("明天记得开会", None).is_none());
        assert!(parse_natural("每0分钟提醒我", None).is_none());
    }

    #[tokio::test]
    async fn engine_fires_event() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let engine = ReminderEngine::new(tx);
        // 每 2 秒触发一次,验证事件真的会从 channel 里出来
        let r = Reminder::new(
            "喝水测试",
            ReminderKind::Water,
            "*/2 * * * * *",
            "该喝水啦",
            ReminderLevel::Gentle,
        );
        engine.add(r).await.unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(6), rx.recv())
            .await
            .expect("提醒没有按时触发")
            .expect("channel 已关闭");
        assert_eq!(event.reminder.kind, ReminderKind::Water);
        assert_eq!(event.reminder.message, "该喝水啦");
    }

    #[tokio::test]
    async fn engine_add_remove() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let engine = ReminderEngine::new(tx);
        let r = Reminder::new(
            "test",
            ReminderKind::Custom,
            "0 */5 * * * *",
            "msg",
            ReminderLevel::Gentle,
        );
        let id = engine.add(r).await.unwrap();
        assert_eq!(engine.list().await.len(), 1);
        assert!(engine.set_enabled(&id, false).await);
        assert!(engine.set_enabled(&id, true).await);
        assert!(engine.remove(&id).await);
        assert!(engine.list().await.is_empty());
    }
}
