#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub at_ms: i64,
    pub used_percent: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BurnRate {
    pub enabled: bool,
    pub runway_minutes: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerMode {
    Off,
    Ask,
    Auto,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerAction {
    None,
    Ask,
    Create,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TriggerOutcome {
    pub action: TriggerAction,
    pub reason: &'static str,
}

pub fn evaluate_trigger(
    used_percent: Option<f64>,
    threshold: f64,
    mode: TriggerMode,
    deduped: bool,
    samples: &[Sample],
    burn: &BurnRate,
) -> TriggerOutcome {
    if matches!(mode, TriggerMode::Off) {
        return none("off");
    }

    let Some(used_percent) = used_percent else {
        return none("unknown");
    };

    if used_percent >= threshold {
        return fire(mode, deduped, "threshold");
    }

    if burn.enabled {
        let Some(eta) = project_minutes_to_100(samples, used_percent) else {
            return none("insufficient-samples");
        };
        if eta <= burn.runway_minutes {
            return fire(mode, deduped, "burn-rate");
        }
    }

    none("below")
}

fn fire(mode: TriggerMode, deduped: bool, reason: &'static str) -> TriggerOutcome {
    if deduped {
        return none("deduped");
    }

    TriggerOutcome {
        action: match mode {
            TriggerMode::Auto => TriggerAction::Create,
            TriggerMode::Ask | TriggerMode::Off => TriggerAction::Ask,
        },
        reason,
    }
}

fn none(reason: &'static str) -> TriggerOutcome {
    TriggerOutcome {
        action: TriggerAction::None,
        reason,
    }
}

fn project_minutes_to_100(samples: &[Sample], used_percent: f64) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }

    let mut sorted = samples.to_vec();
    sorted.sort_by_key(|sample| sample.at_ms);

    let first = sorted.first()?;
    let last = sorted.last()?;
    let d_pct = last.used_percent - first.used_percent;
    let d_min = (last.at_ms - first.at_ms) as f64 / 60_000.0;
    if d_min <= 0.0 || d_pct <= 0.0 {
        return None;
    }

    let slope = d_pct / d_min;
    let remaining = 100.0 - used_percent;
    if remaining <= 0.0 {
        return Some(0.0);
    }

    Some(remaining / slope)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_burn() -> BurnRate {
        BurnRate {
            enabled: false,
            runway_minutes: 30.0,
        }
    }

    #[test]
    fn off_mode_is_none() {
        let o = evaluate_trigger(Some(99.0), 80.0, TriggerMode::Off, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None));
        assert_eq!(o.reason, "off");
    }

    #[test]
    fn unknown_used_percent_is_none() {
        let o = evaluate_trigger(None, 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None));
        assert_eq!(o.reason, "unknown");
    }

    #[test]
    fn at_threshold_fires_ask_in_ask_mode() {
        let o = evaluate_trigger(Some(80.0), 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::Ask));
        assert_eq!(o.reason, "threshold");
    }

    #[test]
    fn at_threshold_fires_create_in_auto_mode() {
        let o = evaluate_trigger(Some(85.0), 80.0, TriggerMode::Auto, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::Create));
        assert_eq!(o.reason, "threshold");
    }

    #[test]
    fn deduped_suppresses_fire() {
        let o = evaluate_trigger(Some(90.0), 80.0, TriggerMode::Auto, true, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None));
        assert_eq!(o.reason, "deduped");
    }

    #[test]
    fn burn_rate_fires_when_eta_within_runway() {
        let burn = BurnRate {
            enabled: true,
            runway_minutes: 30.0,
        };
        let samples = vec![
            Sample {
                at_ms: 0,
                used_percent: 50.0,
            },
            Sample {
                at_ms: 300_000,
                used_percent: 60.0,
            },
        ];
        let o = evaluate_trigger(Some(60.0), 80.0, TriggerMode::Ask, false, &samples, &burn);
        assert!(matches!(o.action, TriggerAction::Ask));
        assert_eq!(o.reason, "burn-rate");
    }

    #[test]
    fn below_threshold_no_burn_is_below() {
        let o = evaluate_trigger(Some(40.0), 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None));
        assert_eq!(o.reason, "below");
    }

    #[test]
    fn burn_rate_insufficient_samples() {
        let burn = BurnRate {
            enabled: true,
            runway_minutes: 30.0,
        };
        let o = evaluate_trigger(Some(40.0), 80.0, TriggerMode::Ask, false, &[], &burn);
        assert!(matches!(o.action, TriggerAction::None));
        assert_eq!(o.reason, "insufficient-samples");
    }
}
