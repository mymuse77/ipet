/// 极简 i18n:中文(zh,默认)/英文(en)。出海时所有前端文案走这个表。
pub fn t(lang: &str, key: &str) -> String {
    let zh = lang.starts_with("zh");
    match (zh, key) {
        (true, "drink_water") => "该喝水啦",
        (false, "drink_water") => "Time to drink some water",
        (true, "eye_rest") => "看看远处,放松一下眼睛",
        (false, "eye_rest") => "Look away and rest your eyes",
        (true, "take_break") => "起来活动一下吧",
        (false, "take_break") => "Time for a break, stretch a bit",
        (true, "task_done") => "任务完成啦,快来看看结果",
        (false, "task_done") => "Task done, come check the result",
        (true, "agent_error") => "出了一点小状况",
        (false, "agent_error") => "Something went wrong",
        (true, "good_morning") => "早上好,今天也要加油哦",
        (false, "good_morning") => "Good morning, have a great day",
        _ => key,
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zh_en() {
        assert_eq!(t("zh", "drink_water"), "该喝水啦");
        assert_eq!(t("en", "drink_water"), "Time to drink some water");
        assert_eq!(t("zh", "unknown_key"), "unknown_key");
    }
}
