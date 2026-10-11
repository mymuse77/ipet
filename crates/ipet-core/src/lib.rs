//! ipet-core: 桌面宠物 ipet 的 Rust 核心库。
//!
//! 包含四个模块:
//! - `config`: 应用配置的加载/保存(JSON,位于用户配置目录)
//! - `reminder`: 提醒引擎 —— cron 调度 + 中文自然语言创建提醒
//! - `agent`: Agent 桥接 —— 通过 MCP(rmcp 官方 SDK)以 stdio 子进程接入用户本地 agent
//! - `i18n`: 简单的中文/英文文案

pub mod affection;
pub mod agent;
pub mod config;
pub mod i18n;
pub mod pomodoro;
pub mod reminder;

pub use affection::{Affection, Interaction, Mood};
pub use agent::{AgentBridge, McpServerConfig};
pub use pomodoro::{Pomodoro, PomodoroPhase, PomodoroStatus};
pub use config::AppConfig;
pub use reminder::{
    parse_natural, Reminder, ReminderEngine, ReminderEvent, ReminderKind, ReminderLevel,
};
