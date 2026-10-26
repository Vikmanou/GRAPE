//! A segment's bases, read back the way the parser stored them.

use crate::store::seg_flags::{SEQ_REVERSED, SEQ_WRAPPED};
use crate::store::seq::Packed;

/// The segment's bases from file bytes starting at its sequence offset, or
/// `None` when `bytes` ends before the sequence does. FASTG lines are joined
/// as the parser counted them: each line trimmed, blank lines skipped.
pub fn bases_from_file(bytes: &[u8], length: u32, flags: u8) -> Option<Vec<u8>> {
    let length = length as usize;
    let mut out = Vec::with_capacity(length);
    if flags & SEQ_WRAPPED == 0 {
        out.extend_from_slice(bytes.get(..length)?);
    } else {
        let mut lines = bytes.split(|&b| b == b'\n');
        while out.len() < length {
            let line = lines.next()?.trim_ascii();
            out.extend_from_slice(&line[..line.len().min(length - out.len())]);
        }
    }
    Some(oriented(out, flags))
}

pub fn bases_from_packed(packed: &Packed, start: u64, length: u32, flags: u8) -> Option<Vec<u8>> {
    let end = start.checked_add(u64::from(length))?;
    if packed.dropped || end > packed.bases {
        return None;
    }
    Some(oriented(packed.decode(start, u64::from(length)), flags))
}

/// A FASTG segment known only from its reverse record stores that record's bases.
fn oriented(bases: Vec<u8>, flags: u8) -> Vec<u8> {
    if flags & SEQ_REVERSED == 0 {
        bases
    } else {
        reverse_complement(&bases)
    }
}

/// Bandage's `AssemblyGraph::getReverseComplement` (graph/assemblygraph.cpp):
/// IUPAC codes complemented, case kept, `N . - ? *` kept, anything else dropped.
pub fn reverse_complement(bases: &[u8]) -> Vec<u8> {
    bases.iter().rev().filter_map(|&b| complement(b)).collect()
}

fn complement(b: u8) -> Option<u8> {
    let c = match b.to_ascii_uppercase() {
        b'A' => b'T',
        b'T' => b'A',
        b'G' => b'C',
        b'C' => b'G',
        b'R' => b'Y',
        b'Y' => b'R',
        b'S' => b'S',
        b'W' => b'W',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'D' => b'H',
        b'H' => b'D',
        b'V' => b'B',
        b'N' => b'N',
        b'.' | b'-' | b'?' | b'*' => return Some(b),
        _ => return None,
    };
    Some(if b.is_ascii_lowercase() {
        c.to_ascii_lowercase()
    } else {
        c
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::seg_flags::{SEQ_REVERSED, SEQ_WRAPPED};

    #[test]
    fn reverse_complement_follows_bandage() {
        assert_eq!(
            reverse_complement(b"ACGTacgtRYKMbdhvN.-?*"),
            b"*?-.NbdhvKMRYacgtACGT"
        );
        assert_eq!(reverse_complement(b"AXUa"), b"tT");
    }

    #[test]
    fn wrapped_lines_are_joined_and_reversed_records_flipped() {
        let file = b"AC\r\n  GT \n\nTTx\n>EDGE";
        assert_eq!(bases_from_file(file, 6, SEQ_WRAPPED).unwrap(), b"ACGTTT");
        assert_eq!(
            bases_from_file(file, 6, SEQ_WRAPPED | SEQ_REVERSED).unwrap(),
            b"AAACGT"
        );
        assert_eq!(bases_from_file(b"AC\nG", 4, SEQ_WRAPPED), None);
        assert_eq!(bases_from_file(b"ACGT\tLN:i:4", 4, 0).unwrap(), b"ACGT");
        assert_eq!(bases_from_file(b"ACG", 4, 0), None);
    }
}
