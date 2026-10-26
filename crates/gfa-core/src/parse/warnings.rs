use std::fmt;

/// Beyond this only the count grows, so a file where every line is broken
/// cannot exhaust memory.
pub const MAX_STORED: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Warning,
    /// The graph loaded but is known to be wrong.
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarningKind {
    Malformed,
    MalformedTag,
    DuplicateSegment,
    MissingLength,
    LengthMismatch,
    OverlapConflict,
    ComplexOverlap,
    UndefinedSegment,
    UnknownRecord,
    SequencesDropped,
    SegmentTooLong,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    /// 1-based.
    pub line: u64,
    pub severity: Severity,
    pub kind: WarningKind,
    pub message: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Warnings {
    pub list: Vec<Warning>,
    pub total: u64,
}

impl Warnings {
    pub(crate) fn push(&mut self, line: u64, kind: WarningKind, message: impl FnOnce() -> String) {
        let severity = match kind {
            WarningKind::UndefinedSegment => Severity::Error,
            _ => Severity::Warning,
        };
        self.total += 1;
        if self.list.len() < MAX_STORED {
            self.list.push(Warning {
                line,
                severity,
                kind,
                message: message(),
            });
        }
    }

    pub fn count(&self, kind: WarningKind) -> usize {
        self.list.iter().filter(|w| w.kind == kind).count()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FatalError {
    NotText,
    NoSegments,
    Gfa2 { line: u64 },
    TooLarge,
}

impl fmt::Display for FatalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotText => write!(
                f,
                "This is not a text file. GRAPE reads GFA 1.0/1.1 and FASTG."
            ),
            Self::NoSegments => write!(f, "The file has no segments."),
            Self::Gfa2 { line } => write!(
                f,
                "GFA 2.0 is not supported (line {line}). GRAPE reads GFA 1.0/1.1 and FASTG."
            ),
            Self::TooLarge => write!(f, "The graph has more names than GRAPE can index."),
        }
    }
}

impl std::error::Error for FatalError {}

/// A name as it appears in messages.
pub(crate) fn show(name: &[u8]) -> String {
    const MAX: usize = 60;
    let text = String::from_utf8_lossy(name);
    if text.chars().count() <= MAX {
        return text.into_owned();
    }
    let cut: String = text.chars().take(MAX).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_up_to_the_cap() {
        let mut w = Warnings::default();
        for i in 0..(MAX_STORED as u64 + 5) {
            w.push(i, WarningKind::Malformed, String::new);
        }
        assert_eq!(w.list.len(), MAX_STORED);
        assert_eq!(w.total, MAX_STORED as u64 + 5);
    }

    #[test]
    fn undefined_segments_are_errors() {
        let mut w = Warnings::default();
        w.push(1, WarningKind::UndefinedSegment, String::new);
        assert_eq!(w.list[0].severity, Severity::Error);
    }

    #[test]
    fn long_names_are_cut() {
        assert_eq!(show(b"abc"), "abc");
        assert_eq!(show(&[b'x'; 100]).chars().count(), 61);
    }
}
