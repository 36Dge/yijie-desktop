use std::fmt::{Debug, Formatter};
use zeroize::Zeroizing;

pub struct SecretValue(Zeroizing<String>);

impl SecretValue {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl Clone for SecretValue {
    fn clone(&self) -> Self {
        Self::new(self.expose().to_owned())
    }
}

impl Debug for SecretValue {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretValue([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_is_redacted() {
        let value = SecretValue::new("never-log-me".to_owned());
        let output = format!("{value:?}");

        assert!(!output.contains("never-log-me"));
        assert!(output.contains("REDACTED"));
    }
}
