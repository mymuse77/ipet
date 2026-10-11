use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::agent::McpServerConfig;
use crate::reminder::{Reminder, ReminderKind, ReminderLevel};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetConfig {
    /// VRM 模型路径(相对 ui/public 或绝对路径)
    pub model_path: String,
    pub scale: f32,
    /// 当前人格/皮肤标识,对应某个 agent 或内置人格
    pub persona: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DoNotDisturb {
    pub enabled: bool,
    /// 检测到全屏应用(会议/游戏)时自动静默提醒
    #[serde(default)]
    pub fullscreen_auto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub language: String,
    pub pet: PetConfig,
    pub agents: Vec<McpServerConfig>,
    pub reminders: Vec<Reminder>,
    pub do_not_disturb: DoNotDisturb,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "zh".to_string(),
            pet: PetConfig {
                model_path: "assets/model.vrm".to_string(),
                scale: 1.0,
                persona: "assistant".to_string(),
            },
            agents: Vec::new(),
            reminders: vec![
                Reminder::new(
                    "喝水提醒",
                    ReminderKind::Water,
                    "0 */45 9-18 * * *",
                    "该喝水啦,起来接杯水活动一下吧",
                    ReminderLevel::Gentle,
                ),
                Reminder::new(
                    "远眺护眼",
                    ReminderKind::EyeRest,
                    "0 */20 * * * *",
                    "看了 20 分钟屏幕了,看看 6 米外的远处 20 秒",
                    ReminderLevel::Gentle,
                ),
                Reminder::new(
                    "起来休息",
                    ReminderKind::Break,
                    "0 */50 9-19 * * *",
                    "工作 50 分钟了,站起来走走、拉伸一下",
                    ReminderLevel::Normal,
                ),
            ],
            do_not_disturb: DoNotDisturb {
                enabled: false,
                fullscreen_auto: true,
            },
        }
    }
}

impl AppConfig {
    pub fn path() -> Option<PathBuf> {
        dirs::config_dir().map(|p| p.join("ipet").join("config.json"))
    }

    /// 加载配置;文件不存在或解析失败时返回默认配置
    pub fn load() -> Self {
        match Self::path().and_then(|p| std::fs::read_to_string(p).ok()) {
            Some(text) => serde_json::from_str(&text).unwrap_or_default(),
            None => Self::default(),
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        if let Some(path) = Self::path() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, serde_json::to_string_pretty(self).unwrap())?;
        }
        Ok(())
    }
}
