//! ipet 桌面端主程序(Tauri 2)。
//!
//! 窗口:透明、无边框、置顶、不进任务栏 —— 宠物浮在桌面上。
//! 职责:把 ipet-core 的提醒事件/agent 结果转发给前端做动画与播报,
//!      把前端的交互(拖拽/点击/设置)转成对 core 的调用。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::{Emitter, Manager, State, Window};
use tokio::sync::{mpsc, RwLock};

use ipet_core::{
    parse_natural, Affection, AgentBridge, AppConfig, Interaction, McpServerConfig, Mood, Pomodoro,
    PomodoroPhase, Reminder, ReminderEngine, ReminderEvent, ReminderKind, ReminderLevel,
};

struct AppState {
    engine: ReminderEngine,
    agents: AgentBridge,
    affection: RwLock<Affection>,
    pomodoro: RwLock<Pomodoro>,
    config: RwLock<AppConfig>,
}

/// 前端收到的提醒事件载荷
#[derive(Clone, serde::Serialize)]
struct ReminderPayload {
    name: String,
    kind: String,
    message: String,
    level: String,
    fired_at: String,
}

fn kind_str(k: ReminderKind) -> &'static str {
    match k {
        ReminderKind::Water => "water",
        ReminderKind::EyeRest => "eye_rest",
        ReminderKind::Break => "break",
        ReminderKind::Custom => "custom",
    }
}

fn level_str(l: ReminderLevel) -> &'static str {
    match l {
        ReminderLevel::Gentle => "gentle",
        ReminderLevel::Normal => "normal",
        ReminderLevel::Strong => "strong",
    }
}

// ---------- 提醒相关命令 ----------

#[tauri::command]
async fn list_reminders(state: State<'_, Arc<AppState>>) -> Result<Vec<Reminder>, String> {
    Ok(state.engine.list().await)
}

#[tauri::command]
async fn add_reminder(
    state: State<'_, Arc<AppState>>,
    name: String,
    kind: String,
    cron_expr: String,
    message: String,
    level: String,
) -> Result<String, String> {
    let kind = match kind.as_str() {
        "water" => ReminderKind::Water,
        "eye_rest" => ReminderKind::EyeRest,
        "break" => ReminderKind::Break,
        _ => ReminderKind::Custom,
    };
    let level = match level.as_str() {
        "gentle" => ReminderLevel::Gentle,
        "strong" => ReminderLevel::Strong,
        _ => ReminderLevel::Normal,
    };
    let reminder = Reminder::new(&name, kind, &cron_expr, &message, level);
    state.engine.add(reminder).await
}

/// 中文自然语言创建提醒,例如 "每45分钟提醒我喝水"
#[tauri::command]
async fn add_reminder_natural(
    state: State<'_, Arc<AppState>>,
    text: String,
) -> Result<String, String> {
    let reminder =
        parse_natural(&text, None).ok_or_else(|| "没理解这条提醒,试试\"每45分钟提醒我喝水\"".to_string())?;
    state.engine.add(reminder).await
}

#[tauri::command]
async fn remove_reminder(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, String> {
    Ok(state.engine.remove(&id).await)
}

#[tauri::command]
async fn set_reminder_enabled(
    state: State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    Ok(state.engine.set_enabled(&id, enabled).await)
}

// ---------- 亲密度 / 情绪 ----------

#[derive(Clone, serde::Serialize)]
struct AffectionView {
    score: f32,
    mood: String,
    interactions_today: u32,
}

fn mood_str(m: Mood) -> &'static str {
    match m {
        Mood::Happy => "happy",
        Mood::Content => "content",
        Mood::Lonely => "lonely",
        Mood::Sad => "sad",
    }
}

#[tauri::command]
async fn affection_get(state: State<'_, Arc<AppState>>) -> Result<AffectionView, String> {
    let a = state.affection.read().await;
    Ok(AffectionView {
        score: a.score,
        mood: mood_str(a.mood()).to_string(),
        interactions_today: a.interactions_today,
    })
}

/// kind: pet / praise / water_done / break_done / ignored
/// 返回变化后的情绪，前端据此切换宠物的表情
#[tauri::command]
async fn affection_interact(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<String, String> {
    let interaction = match kind.as_str() {
        "pet" => Interaction::Pet,
        "praise" => Interaction::Praise,
        "water_done" => Interaction::WaterDone,
        "break_done" => Interaction::BreakDone,
        "ignored" => Interaction::Ignored,
        _ => return Err(format!("未知的互动类型: {kind}")),
    };
    let mut a = state.affection.write().await;
    Ok(mood_str(a.interact(interaction)).to_string())
}

// ---------- 番茄钟 ----------

#[tauri::command]
async fn pomodoro_start(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let mut p = state.pomodoro.write().await;
    p.start();
    Ok(phase_str(p.status().phase).to_string())
}

#[tauri::command]
async fn pomodoro_stop(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    state.pomodoro.write().await.stop();
    Ok("idle".to_string())
}

#[tauri::command]
async fn pomodoro_skip(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let mut p = state.pomodoro.write().await;
    p.skip();
    Ok(phase_str(p.status().phase).to_string())
}

#[derive(Clone, serde::Serialize)]
struct PomodoroView {
    phase: String,
    remaining_secs: u64,
    completed_cycles: u32,
}

fn phase_str(p: PomodoroPhase) -> &'static str {
    match p {
        PomodoroPhase::Idle => "idle",
        PomodoroPhase::Focus => "focus",
        PomodoroPhase::ShortBreak => "short_break",
        PomodoroPhase::LongBreak => "long_break",
    }
}

#[tauri::command]
async fn pomodoro_status(state: State<'_, Arc<AppState>>) -> Result<PomodoroView, String> {
    let mut p = state.pomodoro.write().await;
    let s = p.status();
    Ok(PomodoroView {
        phase: phase_str(s.phase).to_string(),
        remaining_secs: s.remaining_secs,
        completed_cycles: s.completed_cycles,
    })
}

// ---------- Agent 相关命令 ----------

#[tauri::command]
async fn agent_register(
    state: State<'_, Arc<AppState>>,
    name: String,
    command: String,
    args: Vec<String>,
    persona: String,
) -> Result<(), String> {
    state
        .agents
        .register(McpServerConfig {
            name,
            command,
            args,
            persona,
        })
        .await;
    Ok(())
}

#[tauri::command]
async fn agent_connect(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Vec<String>, String> {
    state.agents.connect(&name).await
}

#[tauri::command]
async fn agent_call_tool(
    state: State<'_, Arc<AppState>>,
    server: String,
    tool: String,
    args: serde_json::Value,
) -> Result<String, String> {
    state.agents.call_tool(&server, &tool, args).await
}

#[tauri::command]
async fn agent_connected(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.agents.connected().await)
}

// ---------- 窗口行为 ----------

/// 点击穿透开关:开启后鼠标事件穿过宠物,适合专注工作时
#[tauri::command]
async fn set_click_through(window: Window, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<ReminderEvent>();
    let config = AppConfig::load();
    let engine = ReminderEngine::new(tx);
    let agents = AgentBridge::new(config.agents.clone());

    // 把配置里的默认提醒装进引擎
    let engine_clone = engine;
    let boot_reminders = config.reminders.clone();
    tauri::async_runtime::block_on(async {
        for r in boot_reminders {
            let _ = engine_clone.add(r).await;
        }
    });

    let state = Arc::new(AppState {
        engine: engine_clone,
        agents,
        affection: RwLock::new(Affection::new()),
        pomodoro: RwLock::new(Pomodoro::new()),
        config: RwLock::new(config),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(|app| {
            // 提醒事件 -> 前端宠物(动画/气泡/语音)
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    let payload = ReminderPayload {
                        name: event.reminder.name.clone(),
                        kind: kind_str(event.reminder.kind).to_string(),
                        message: event.reminder.message.clone(),
                        level: level_str(event.reminder.level).to_string(),
                        fired_at: event.fired_at.to_rfc3339(),
                    };
                    let _ = handle.emit("ipet://reminder", payload);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_reminders,
            add_reminder,
            add_reminder_natural,
            remove_reminder,
            set_reminder_enabled,
            affection_get,
            affection_interact,
            pomodoro_start,
            pomodoro_stop,
            pomodoro_skip,
            pomodoro_status,
            agent_register,
            agent_connect,
            agent_call_tool,
            agent_connected,
            set_click_through,
        ])
        .run(tauri::generate_context!())
        .expect("ipet 启动失败");
}
