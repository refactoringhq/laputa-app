use chrono::{DateTime, Duration, Months, NaiveDate, NaiveDateTime, Utc};

fn parse_relative_amount(token: &str) -> Option<u32> {
    match token {
        "a" | "an" | "one" => Some(1),
        "two" => Some(2),
        "three" => Some(3),
        "four" => Some(4),
        "five" => Some(5),
        "six" => Some(6),
        "seven" => Some(7),
        "eight" => Some(8),
        "nine" => Some(9),
        "ten" => Some(10),
        "eleven" => Some(11),
        "twelve" => Some(12),
        _ => token.parse::<u32>().ok(),
    }
}

fn parse_relative_date_filter(value: &str, reference: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    let base = reference.date_naive().and_hms_opt(0, 0, 0)?.and_utc();
    match normalized.as_str() {
        "today" => return Some(base),
        "yesterday" => return Some(base - Duration::days(1)),
        "tomorrow" => return Some(base + Duration::days(1)),
        _ => {}
    }

    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    let (future, amount_token, unit_token) = match tokens.as_slice() {
        ["in", amount, unit] => (true, *amount, *unit),
        [amount, unit, "ago"] => (false, *amount, *unit),
        _ => return None,
    };

    let amount = parse_relative_amount(amount_token)?;
    let unit = unit_token.strip_suffix('s').unwrap_or(unit_token);

    match (future, unit) {
        (true, "day") => Some(base + Duration::days(amount as i64)),
        (false, "day") => Some(base - Duration::days(amount as i64)),
        (true, "week") => Some(base + Duration::weeks(amount as i64)),
        (false, "week") => Some(base - Duration::weeks(amount as i64)),
        (true, "month") => base.checked_add_months(Months::new(amount)),
        (false, "month") => base.checked_sub_months(Months::new(amount)),
        (true, "year") => base.checked_add_months(Months::new(amount * 12)),
        (false, "year") => base.checked_sub_months(Months::new(amount * 12)),
        _ => None,
    }
}

pub(super) fn parse_date_filter_timestamp(value: &str, reference: DateTime<Utc>) -> Option<i64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }

    if let Ok(datetime) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S") {
        return Some(datetime.and_utc().timestamp_millis());
    }

    if let Ok(datetime) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(datetime.with_timezone(&Utc).timestamp_millis());
    }

    parse_relative_date_filter(trimmed, reference).map(|datetime| datetime.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn parses_relative_days_ago() {
        let reference = Utc.with_ymd_and_hms(2026, 4, 7, 12, 0, 0).unwrap();
        let parsed = parse_date_filter_timestamp("10 days ago", reference).unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 3, 28, 0, 0, 0)
            .unwrap()
            .timestamp_millis();

        assert_eq!(parsed, expected);
    }

    #[test]
    fn parses_relative_one_week_ago() {
        let reference = Utc.with_ymd_and_hms(2026, 4, 7, 12, 0, 0).unwrap();
        let parsed = parse_date_filter_timestamp("one week ago", reference).unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 3, 31, 0, 0, 0)
            .unwrap()
            .timestamp_millis();

        assert_eq!(parsed, expected);
    }
}
