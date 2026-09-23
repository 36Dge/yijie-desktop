use super::generated::{ScheduleErrorCode as Error, TimePreview, TimeRule, TimeRuleFrequency};
use chrono::{DateTime, Datelike, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rrule::RRuleSet;

pub const RULE_VERSION: i64 = 1;
pub const CANDIDATE_LIMIT: u16 = 16;
const MAX_INSTANT: i64 = 253_402_300_799;

pub fn validate_instant(value: i64) -> Result<DateTime<Utc>, Error> {
    if !(0..=MAX_INSTANT).contains(&value) {
        return Err(Error::InvalidInput);
    }
    DateTime::from_timestamp(value, 0).ok_or(Error::InvalidInput)
}

pub fn validate_rule(rule: &TimeRule) -> Result<(Tz, NaiveTime), Error> {
    let zone = rule
        .time_zone
        .parse::<Tz>()
        .map_err(|_| Error::InvalidInput)?;
    let time =
        NaiveTime::parse_from_str(&rule.local_time, "%H:%M").map_err(|_| Error::InvalidInput)?;
    if time.format("%H:%M").to_string() != rule.local_time {
        return Err(Error::InvalidInput);
    }
    match rule.frequency {
        TimeRuleFrequency::Once => {
            let date = rule.local_date.as_deref().ok_or(Error::InvalidInput)?;
            let day =
                NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| Error::InvalidInput)?;
            if day.format("%Y-%m-%d").to_string() != date || rule.weekdays.is_some() {
                return Err(Error::InvalidInput);
            }
            let instant = zone
                .from_local_datetime(&day.and_time(time))
                .earliest()
                .ok_or(Error::InvalidInput)?;
            validate_instant(instant.timestamp())?;
        }
        TimeRuleFrequency::Weekly => {
            let days = rule.weekdays.as_ref().ok_or(Error::InvalidInput)?;
            let mut unique = std::collections::BTreeSet::new();
            if rule.local_date.is_some()
                || days.is_empty()
                || days.len() > 7
                || days
                    .iter()
                    .any(|day| !(1..=7).contains(day) || !unique.insert(*day))
            {
                return Err(Error::InvalidInput);
            }
        }
        TimeRuleFrequency::Daily | TimeRuleFrequency::Weekdays => {
            if rule.local_date.is_some() || rule.weekdays.is_some() {
                return Err(Error::InvalidInput);
            }
        }
    }
    Ok((zone, time))
}

/// `after` is exclusive; `effective_from` is inclusive. Calendar candidates start
/// at this query's local reference day, never at the plan's historic creation.
/// RRULE selects civil dates in UTC, then chrono-tz resolves each civil time.
/// This separates RFC recurrence from the approved earlier-fold/skip-gap policy.
pub fn preview(rule: &TimeRule, after: i64, effective_from: i64) -> Result<TimePreview, Error> {
    let after_utc = validate_instant(after)?;
    let effective_utc = validate_instant(effective_from)?;
    let (zone, time) = validate_rule(rule)?;
    let mut result = TimePreview {
        next_at: None,
        logical_slot: None,
        skipped_slots: Vec::new(),
        candidates_examined: 0,
        rule_version: RULE_VERSION,
        tzdb_version: chrono_tz::IANA_TZDB_VERSION.to_owned(),
    };
    if rule.frequency == TimeRuleFrequency::Once {
        let day = NaiveDate::parse_from_str(
            rule.local_date.as_deref().ok_or(Error::InvalidInput)?,
            "%Y-%m-%d",
        )
        .map_err(|_| Error::InvalidInput)?;
        let local = day.and_time(time);
        let utc = zone
            .from_local_datetime(&local)
            .earliest()
            .ok_or(Error::InvalidInput)?;
        result.candidates_examined = 1;
        if utc.timestamp() > after && utc.timestamp() >= effective_from {
            result.next_at = Some(utc.timestamp());
            result.logical_slot = Some(local.format("%Y-%m-%dT%H:%M").to_string());
        }
        return Ok(result);
    }
    let day = after_utc
        .max(effective_utc)
        .with_timezone(&zone)
        .date_naive();
    if !(1..=9999).contains(&day.year()) {
        return Err(Error::InvalidInput);
    }
    let expression = match rule.frequency {
        TimeRuleFrequency::Daily => "FREQ=DAILY".to_owned(),
        TimeRuleFrequency::Weekdays => "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".to_owned(),
        TimeRuleFrequency::Weekly => {
            let names = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
            let days = rule.weekdays.as_ref().ok_or(Error::InvalidInput)?;
            format!(
                "FREQ=WEEKLY;BYDAY={}",
                days.iter()
                    .map(|day| names[(*day - 1) as usize])
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        TimeRuleFrequency::Once => unreachable!(),
    };
    let source = format!(
        "DTSTART:{}\nRRULE:{}",
        day.and_time(time).format("%Y%m%dT%H%M%SZ"),
        expression
    );
    let set: RRuleSet = source.parse().map_err(|_| Error::InvalidInput)?;
    let dates = set.all(CANDIDATE_LIMIT).dates;
    for candidate in dates {
        result.candidates_examined += 1;
        let local = candidate.naive_utc();
        match zone.from_local_datetime(&local) {
            LocalResult::None => result
                .skipped_slots
                .push(local.format("%Y-%m-%dT%H:%M").to_string()),
            resolution => {
                let utc = resolution.earliest().ok_or(Error::InvalidInput)?;
                if utc.timestamp() > after && utc.timestamp() >= effective_from {
                    validate_instant(utc.timestamp())?;
                    result.next_at = Some(utc.timestamp());
                    result.logical_slot = Some(local.format("%Y-%m-%dT%H:%M").to_string());
                    return Ok(result);
                }
            }
        }
    }
    Err(Error::TimeQueryExhausted)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Continuity {
    ContinuousAwake,
    Recovered,
    ClockDiscontinuity,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueDecision {
    Future,
    Eligible,
    MissedLate,
    MissedOffline,
    ClockDiscontinuity,
}

/// Pure decision only. A native lifecycle owner must supply actual continuity
/// evidence in phase three; no timer or sleep observation exists in this phase.
pub fn due_decision(
    scheduled_at: i64,
    now: i64,
    continuity: Continuity,
) -> Result<DueDecision, Error> {
    validate_instant(scheduled_at)?;
    validate_instant(now)?;
    if scheduled_at > now {
        return Ok(DueDecision::Future);
    }
    Ok(match continuity {
        Continuity::Recovered => DueDecision::MissedOffline,
        Continuity::ClockDiscontinuity => DueDecision::ClockDiscontinuity,
        Continuity::ContinuousAwake if now - scheduled_at <= 60 => DueDecision::Eligible,
        Continuity::ContinuousAwake => DueDecision::MissedLate,
    })
}
