use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 番茄钟阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    Idle,
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroStatus {
    pub phase: PomodoroPhase,
    /// 当前阶段剩余秒数
    pub remaining_secs: u64,
    /// 已完成的专注轮数
    pub completed_cycles: u32,
}

/// 番茄钟：25 分钟专注 → 5 分钟休息，4 轮后长休息 15 分钟。
/// 与提醒引擎联动：专注结束自动触发"远眺/休息"提醒事件（由 Tauri 层订阅状态轮询实现）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pomodoro {
    pub focus_secs: u64,
    pub short_break_secs: u64,
    pub long_break_secs: u64,
    pub cycles_before_long: u32,
    phase: PomodoroPhase,
    phase_end: Option<DateTime<Utc>>,
    completed_cycles: u32,
}

impl Pomodoro {
    pub fn new() -> Self {
        Self {
            focus_secs: 1500, // 25 min
            short_break_secs: 300,
            long_break_secs: 900, // 15 min
            cycles_before_long: 4,
            phase: PomodoroPhase::Idle,
            phase_end: None,
            completed_cycles: 0,
        }
    }

    /// 自定义时长（秒），用于测试或用户偏好
    pub fn with_durations(mut self, focus: u64, short_break: u64, long_break: u64) -> Self {
        self.focus_secs = focus;
        self.short_break_secs = short_break;
        self.long_break_secs = long_break;
        self
    }

    fn phase_duration(&self, phase: PomodoroPhase) -> u64 {
        match phase {
            PomodoroPhase::Focus => self.focus_secs,
            PomodoroPhase::ShortBreak => self.short_break_secs,
            PomodoroPhase::LongBreak => self.long_break_secs,
            PomodoroPhase::Idle => 0,
        }
    }

    pub fn start(&mut self) {
        self.start_phase(PomodoroPhase::Focus, Utc::now());
    }

    fn start_phase(&mut self, phase: PomodoroPhase, now: DateTime<Utc>) {
        self.phase = phase;
        let dur = self.phase_duration(phase);
        self.phase_end = Some(now + chrono::Duration::seconds(dur as i64));
    }

    pub fn stop(&mut self) {
        self.phase = PomodoroPhase::Idle;
        self.phase_end = None;
    }

    /// 立刻进入下一阶段（专注轮按完成计）
    pub fn skip(&mut self) {
        if self.phase == PomodoroPhase::Idle {
            return;
        }
        self.advance(Utc::now());
    }

    fn next_phase(&self) -> PomodoroPhase {
        match self.phase {
            // 注意：调用 advance 时 completed_cycles 已先 +1，
            // 这里直接用取余判断是否到长休息轮
            PomodoroPhase::Focus => {
                if self.completed_cycles % self.cycles_before_long == 0 {
                    PomodoroPhase::LongBreak
                } else {
                    PomodoroPhase::ShortBreak
                }
            }
            PomodoroPhase::ShortBreak | PomodoroPhase::LongBreak => PomodoroPhase::Focus,
            PomodoroPhase::Idle => PomodoroPhase::Idle,
        }
    }

    fn advance(&mut self, now: DateTime<Utc>) {
        if self.phase == PomodoroPhase::Focus {
            self.completed_cycles += 1;
        }
        let next = self.next_phase();
        if next == PomodoroPhase::Idle {
            self.stop();
        } else {
            self.start_phase(next, now);
        }
    }

    /// 查询当前状态；阶段到点自动推进（可传入 now 以便测试）
    pub fn status_at(&mut self, now: DateTime<Utc>) -> PomodoroStatus {
        if let Some(end) = self.phase_end {
            if now >= end && self.phase != PomodoroPhase::Idle {
                self.advance(now);
            }
        }
        let remaining = self
            .phase_end
            .map(|end| (end - now).num_seconds().max(0) as u64)
            .unwrap_or(0);
        PomodoroStatus {
            phase: self.phase,
            remaining_secs: remaining,
            completed_cycles: self.completed_cycles,
        }
    }

    pub fn status(&mut self) -> PomodoroStatus {
        self.status_at(Utc::now())
    }
}

impl Default for Pomodoro {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn tiny() -> Pomodoro {
        Pomodoro::new().with_durations(2, 1, 3)
    }

    #[test]
    fn focus_to_short_break() {
        let mut p = tiny();
        p.start();
        let now = Utc::now();
        let s = p.status_at(now);
        assert_eq!(s.phase, PomodoroPhase::Focus);
        assert!(s.remaining_secs <= 2);
        // 专注结束 → 短休息
        let s = p.status_at(now + Duration::seconds(3));
        assert_eq!(s.phase, PomodoroPhase::ShortBreak);
        assert_eq!(s.completed_cycles, 1);
        // 休息结束 → 回到专注
        let s = p.status_at(now + Duration::seconds(5));
        assert_eq!(s.phase, PomodoroPhase::Focus);
    }

    #[test]
    fn long_break_every_4_cycles() {
        let mut p = tiny();
        p.cycles_before_long = 2;
        p.start();
        let mut now = Utc::now();
        // 第 1 个专注 → 短休息
        now = now + Duration::seconds(3);
        assert_eq!(p.status_at(now).phase, PomodoroPhase::ShortBreak);
        // 短休息 → 第 2 个专注
        now = now + Duration::seconds(2);
        assert_eq!(p.status_at(now).phase, PomodoroPhase::Focus);
        // 第 2 个专注 → 长休息（2 轮）
        now = now + Duration::seconds(3);
        let s = p.status_at(now);
        assert_eq!(s.phase, PomodoroPhase::LongBreak);
        assert_eq!(s.completed_cycles, 2);
    }

    #[test]
    fn skip_and_stop() {
        let mut p = tiny();
        p.start();
        p.skip();
        assert_eq!(p.status().phase, PomodoroPhase::ShortBreak);
        p.stop();
        let s = p.status();
        assert_eq!(s.phase, PomodoroPhase::Idle);
        assert_eq!(s.remaining_secs, 0);
    }
}
