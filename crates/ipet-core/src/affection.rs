use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 宠物情绪，由亲密度分数推导。
/// 互动多它更活泼，好几天不理它会"蔫" —— 长期陪伴感就靠这个。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mood {
    Happy,   // score >= 70
    Content, // score >= 40
    Lonely,  // score >= 15
    Sad,     // score <  15
}

/// 用户与宠物的互动类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Interaction {
    Pet,       // 摸头 / 点击宠物
    Praise,    // 夸奖（预留：语音"真棒"）
    WaterDone, // 按提醒喝了水
    BreakDone, // 按提醒休息了
    Ignored,   // 忽略了一条强提醒
}

/// 亲密度：0–100，养成系统的数值基础
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affection {
    pub score: f32,
    pub interactions_today: u32,
    pub last_active: DateTime<Utc>,
}

impl Affection {
    pub fn new() -> Self {
        Self {
            score: 50.0,
            interactions_today: 0,
            last_active: Utc::now(),
        }
    }

    pub fn mood(&self) -> Mood {
        if self.score >= 70.0 {
            Mood::Happy
        } else if self.score >= 40.0 {
            Mood::Content
        } else if self.score >= 15.0 {
            Mood::Lonely
        } else {
            Mood::Sad
        }
    }

    /// 记录一次互动，返回变化后的情绪
    pub fn interact(&mut self, kind: Interaction) -> Mood {
        let delta = match kind {
            Interaction::Pet => 4.0,
            Interaction::Praise => 3.0,
            Interaction::WaterDone => 5.0,
            Interaction::BreakDone => 5.0,
            Interaction::Ignored => -6.0,
        };
        self.score = (self.score + delta).clamp(0.0, 100.0);
        if delta > 0.0 {
            self.interactions_today += 1;
        }
        self.last_active = Utc::now();
        self.mood()
    }

    /// 按小时自然衰减：长时间不互动，宠物会慢慢变孤单
    pub fn decay(&mut self, hours: f32) -> Mood {
        self.score = (self.score - hours * 0.8).clamp(0.0, 100.0);
        self.mood()
    }
}

impl Default for Affection {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mood_thresholds() {
        let mut a = Affection::new();
        assert_eq!(a.mood(), Mood::Content); // 50
        a.score = 80.0;
        assert_eq!(a.mood(), Mood::Happy);
        a.score = 20.0;
        assert_eq!(a.mood(), Mood::Lonely);
        a.score = 5.0;
        assert_eq!(a.mood(), Mood::Sad);
    }

    #[test]
    fn interact_moves_score() {
        let mut a = Affection::new();
        assert_eq!(a.interact(Interaction::Pet), Mood::Content); // 54
        assert_eq!(a.interactions_today, 1);
        assert_eq!(a.interact(Interaction::WaterDone), Mood::Content); // 59
        // 连续被摸头会变开心
        for _ in 0..3 {
            a.interact(Interaction::Pet);
        }
        assert_eq!(a.mood(), Mood::Happy); // 71
        // 忽略强提醒扣分
        a.interact(Interaction::Ignored);
        assert!(a.score < 71.0);
    }

    #[test]
    fn score_clamps() {
        let mut a = Affection::new();
        a.score = 99.0;
        a.interact(Interaction::Pet);
        assert_eq!(a.score, 100.0);
        a.score = 2.0;
        a.interact(Interaction::Ignored);
        assert_eq!(a.score, 0.0);
        assert_eq!(a.mood(), Mood::Sad);
    }

    #[test]
    fn decay_over_time() {
        let mut a = Affection::new(); // 50
        assert_eq!(a.decay(10.0), Mood::Content); // 42
        assert_eq!(a.decay(40.0), Mood::Sad); // 10 -> clamp 0? 42-32=10 -> Lonely
    }
}
