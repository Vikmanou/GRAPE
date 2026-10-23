//! Core of GRAPE: GFA parsing, the graph store, graph algorithms, stats and
//! sequence search. Pure Rust with no browser dependencies, so everything here
//! is tested natively.

/// Version of this crate, reported to the UI so a stale WASM build is visible.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Counts lines in `bytes`: every `\n` ends a line, and trailing bytes after
/// the last `\n` count as one more line.
///
/// Placeholder for milestone 0, used to prove the WASM call path end to end.
pub fn count_lines(bytes: &[u8]) -> u64 {
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count() as u64;
    let unterminated = matches!(bytes.last(), Some(&b) if b != b'\n');
    newlines + u64::from(unterminated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_has_no_lines() {
        assert_eq!(count_lines(b""), 0);
    }

    #[test]
    fn terminated_lines() {
        assert_eq!(count_lines(b"H\tVN:Z:1.0\nS\t1\tACGT\n"), 2);
    }

    #[test]
    fn unterminated_last_line_counts() {
        assert_eq!(count_lines(b"S\t1\tACGT\nL\t1\t+\t1\t-\t0M"), 2);
    }

    #[test]
    fn blank_lines_count() {
        assert_eq!(count_lines(b"\n\n"), 2);
    }

    #[test]
    fn version_is_set() {
        assert!(!VERSION.is_empty());
    }
}
