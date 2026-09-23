//! Shared native admission barrier. Observation readiness is not scheduled eligibility.
use super::error::ChatError;
use std::sync::{Arc, Mutex};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Recovering,
    ReadyForObservation,
    Suspended,
    Stopping,
    StopPending,
    Stopped,
}
/// Native-only continuity proof. It is never supplied by a renderer or restored from disk.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ContinuityTicket {
    pub process: String,
    pub epoch: u64,
    pub since: i64,
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct ClockRecovery {
    pub epoch: u64,
    pub cutoff: i64,
    pub cause: super::schedules::time::Continuity,
}
#[derive(Debug)]
struct State {
    phase: Phase,
    epoch: u64,
    host: Option<String>,
    clock: Option<(std::time::Instant, i64)>,
    process: String,
    continuous_from: Option<i64>,
    recovery: Option<ClockRecovery>,
    cause: super::schedules::time::Continuity,
}
#[derive(Clone, Debug)]
pub(crate) struct Lifecycle {
    inner: Arc<Mutex<State>>,
}
impl Default for Lifecycle {
    fn default() -> Self {
        Self::new(Phase::ReadyForObservation)
    }
}
impl Lifecycle {
    pub(crate) fn new(phase: Phase) -> Self {
        Self {
            inner: Arc::new(Mutex::new(State {
                phase,
                epoch: 1,
                host: None,
                clock: None,
                process: uuid::Uuid::now_v7().to_string(),
                continuous_from: None,
                recovery: None,
                cause: super::schedules::time::Continuity::Recovered,
            })),
        }
    }
    pub(crate) fn phase(&self) -> Phase {
        self.inner
            .lock()
            .map(|s| s.phase)
            .unwrap_or(Phase::StopPending)
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.inner.lock().map(|s| s.epoch).unwrap_or(0)
    }
    pub(crate) fn transition(&self, phase: Phase) {
        if let Ok(mut s) = self.inner.lock() {
            if matches!(
                s.phase,
                Phase::Stopping | Phase::StopPending | Phase::Stopped
            ) && !matches!(phase, Phase::Stopping | Phase::StopPending | Phase::Stopped)
            {
                return;
            }
            s.epoch = s.epoch.wrapping_add(1);
            s.phase = phase;
            s.clock = None;
            s.continuous_from = None;
            s.recovery = None;
            s.cause = super::schedules::time::Continuity::Recovered;
        }
    }
    pub(crate) fn host(&self, nonce: &str) {
        if let Ok(mut s) = self.inner.lock() {
            if s.host.as_deref() != Some(nonce) {
                s.host = Some(nonce.into());
                s.clock = None;
                s.epoch = s.epoch.wrapping_add(1);
                s.continuous_from = None;
                s.recovery = None;
                s.cause = super::schedules::time::Continuity::Recovered;
                if !matches!(
                    s.phase,
                    Phase::Stopping | Phase::StopPending | Phase::Stopped | Phase::Suspended
                ) {
                    s.phase = Phase::Recovering;
                }
            }
        }
    }
    pub(crate) fn ready(&self, epoch: u64) {
        if let Ok(mut s) = self.inner.lock() {
            if s.epoch == epoch && s.phase == Phase::Recovering {
                s.phase = Phase::ReadyForObservation;
            }
        }
    }
    pub(crate) fn permit(&self) -> Result<u64, ChatError> {
        let s = self
            .inner
            .lock()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        if s.phase != Phase::ReadyForObservation {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(s.epoch)
    }
    pub(crate) fn validate(&self, epoch: u64) -> Result<(), ChatError> {
        if self.permit()? != epoch {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(())
    }
    /// A clock jump invalidates continuity; OS notifications remain the authority
    /// for sleep/wake. A passed interval never grants eligibility by itself.
    pub(crate) fn observe_clock(&self, now: i64) {
        self.observe_clock_at(now, std::time::Instant::now());
    }
    pub(crate) fn observe_clock_at(&self, now: i64, current: std::time::Instant) {
        if let Ok(mut s) = self.inner.lock() {
            let discontinuity = s.clock.is_some_and(|(mono, wall)| {
                ((now - wall) as i128 - current.duration_since(mono).as_secs() as i128).abs() > 2
            });
            s.clock = Some((current, now));
            if discontinuity && matches!(s.phase, Phase::ReadyForObservation | Phase::Recovering) {
                s.epoch = s.epoch.wrapping_add(1);
                s.phase = Phase::Recovering;
                s.continuous_from = None;
                s.recovery = None;
                s.cause = super::schedules::time::Continuity::ClockDiscontinuity;
            }
            if s.continuous_from.is_none() && s.recovery.is_none() {
                s.recovery = Some(ClockRecovery {
                    epoch: s.epoch,
                    cutoff: now,
                    cause: s.cause,
                });
            }
        }
    }
    pub(crate) fn clock_recovery(&self) -> Option<ClockRecovery> {
        self.inner.lock().ok()?.recovery
    }
    pub(crate) fn clocks_recovered(&self, r: ClockRecovery) {
        if let Ok(mut s) = self.inner.lock() {
            if s.epoch == r.epoch
                && s.recovery.is_some_and(|pending| {
                    pending.epoch == r.epoch
                        && pending.cutoff == r.cutoff
                        && pending.cause == r.cause
                })
                && matches!(s.phase, Phase::Recovering | Phase::ReadyForObservation)
            {
                s.continuous_from = Some(r.cutoff);
                s.recovery = None;
            }
        }
    }
    pub(crate) fn ticket(&self) -> Result<ContinuityTicket, ChatError> {
        let s = self
            .inner
            .lock()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        if s.phase != Phase::ReadyForObservation {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(ContinuityTicket {
            process: s.process.clone(),
            epoch: s.epoch,
            since: s
                .continuous_from
                .ok_or(ChatError::OrchestrationUnavailable)?,
        })
    }
    pub(crate) fn validate_ticket(
        &self,
        ticket: &ContinuityTicket,
        scheduled: i64,
        now: i64,
    ) -> Result<(), ChatError> {
        if self.ticket()? != *ticket
            || scheduled <= ticket.since
            || now < scheduled
            || now > scheduled.saturating_add(60)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feat155_3b2_sleep_wake_invalidates_permits_and_requires_recovery() {
        let g = Lifecycle::default();
        let p = g.permit().unwrap();
        g.transition(Phase::Suspended);
        assert!(g.validate(p).is_err());
        g.transition(Phase::Recovering);
        assert!(g.permit().is_err());
        g.ready(p);
        assert!(g.permit().is_err());
        g.ready(g.epoch());
        assert!(g.permit().is_ok());
    }
    #[test]
    fn feat155_3b2_stop_pending_retains_barrier_across_wake_and_host_change() {
        let g = Lifecycle::default();
        g.transition(Phase::Stopping);
        g.transition(Phase::StopPending);
        g.transition(Phase::Recovering);
        g.host("next-host");
        g.ready(g.epoch());
        assert_eq!(g.phase(), Phase::StopPending);
        assert!(g.permit().is_err());
        g.transition(Phase::Stopped);
        assert!(g.permit().is_err());
    }
    #[test]
    fn feat155_3b2_clock_discontinuity_and_generation_require_recovery() {
        let g = Lifecycle::default();
        g.observe_clock(100);
        g.observe_clock(1000);
        assert_eq!(g.phase(), Phase::Recovering);
        g.ready(g.epoch());
        let p = g.permit().unwrap();
        g.host("new");
        assert!(g.validate(p).is_err());
    }
}

#[cfg(test)]
mod trigger_tests {
    use super::*;
    #[test]
    fn feat155_3c2_continuity_window_and_process_generation_are_not_observation_readiness() {
        let g = Lifecycle::default();
        assert!(g.ticket().is_err());
        g.observe_clock(100);
        g.clocks_recovered(g.clock_recovery().unwrap());
        let t = g.ticket().unwrap();
        assert!(g.validate_ticket(&t, 110, 109).is_err());
        assert!(g.validate_ticket(&t, 110, 110).is_ok());
        assert!(g.validate_ticket(&t, 110, 170).is_ok());
        assert!(g.validate_ticket(&t, 110, 171).is_err());
        let reopened = Lifecycle::default();
        reopened.observe_clock(100);
        reopened.clocks_recovered(reopened.clock_recovery().unwrap());
        assert_eq!(reopened.epoch(), g.epoch());
        assert!(reopened.validate_ticket(&t, 110, 110).is_err());
        g.transition(Phase::Suspended);
        g.transition(Phase::Recovering);
        g.ready(g.epoch());
        assert!(g.ticket().is_err());
        let recovering = Lifecycle::new(Phase::Recovering);
        recovering.observe_clock(100);
        recovering.observe_clock(1000);
        let recovery = recovering.clock_recovery().unwrap();
        assert_eq!(recovery.cutoff, 1000);
        assert_eq!(
            recovery.cause,
            crate::chat::schedules::time::Continuity::ClockDiscontinuity
        );
    }
}
