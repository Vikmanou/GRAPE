//! FASTG as SPAdes writes it and Bandage reads it (`buildDeBruijnGraphFromFastg`
//! in <https://github.com/rrwick/Bandage/blob/main/graph/assemblygraph.cpp>):
//!
//! ```text
//! >EDGE_1_length_8_cov_10.5:EDGE_2_length_6_cov_5',EDGE_3_length_6_cov_5;
//! ACGTAC
//! GT
//! ```
//!
//! A trailing `'` marks the reverse-complement record. As in Bandage, the
//! segment name is the number alone and depth is the `cov` field. FASTG
//! states no overlaps, so links get an unknown overlap.

use crate::parse::builder::Builder;
use crate::parse::fields::{self, Overlap};
use crate::parse::gfa::{clamp_length, sequences_dropped};
use crate::parse::warnings::{WarningKind, show};
use crate::store::seg_flags;
use crate::store::seq::BaseCount;

#[derive(Debug, Default)]
pub(crate) struct Fastg {
    current: Option<Record>,
}

/// The record whose sequence lines are streaming in.
#[derive(Debug)]
struct Record {
    id: u32,
    offset: Option<u64>,
    packed_start: u64,
    count: BaseCount,
    line: u64,
}

impl Fastg {
    pub(crate) fn line(&mut self, b: &mut Builder, line: &[u8], offset: u64, no: u64) {
        if let Some(header) = line.trim_ascii_start().strip_prefix(b">") {
            self.close(b);
            self.header(b, header, no);
            return;
        }
        let seq = line.trim_ascii();
        if seq.is_empty() {
            return;
        }
        let Some(record) = &mut self.current else {
            return;
        };
        record.count.add(seq);
        if record.offset.is_none() {
            record.offset = Some(offset + (seq.as_ptr() as usize - line.as_ptr() as usize) as u64);
        }
        if let Some(packed) = &mut b.packed
            && !packed.append(seq)
        {
            sequences_dropped(b, no);
        }
    }

    fn header(&mut self, b: &mut Builder, header: &[u8], no: u64) {
        let header = header.trim_ascii_end();
        let header = header.strip_suffix(b";").unwrap_or(header);
        let (this, neighbours) = match header.iter().position(|&c| c == b':') {
            Some(i) => (&header[..i], &header[i + 1..]),
            None => (header, &b""[..]),
        };
        let Some(EdgeName {
            name,
            reverse,
            parts,
        }) = edge_name(this)
        else {
            let message = || {
                format!(
                    "FASTG header is not EDGE_<n>_length_<l>_cov_<c>: '{}'",
                    show(this)
                )
            };
            return b.warn(no, WarningKind::Malformed, message);
        };
        let Some(cov) = parts.get(5).and_then(|c| fields::number(c)) else {
            let message = || format!("FASTG header has no readable cov field: '{}'", show(this));
            return b.warn(no, WarningKind::Malformed, message);
        };

        let Some((id, _)) = b.segment_id(name) else {
            return;
        };
        let flags = b.segments.flags[id as usize];
        let defined = flags & seg_flags::DEFINED != 0;
        let from_reverse_record = flags & seg_flags::SEQ_REVERSED != 0;
        // The forward record defines a segment. A reverse record does only
        // while no forward one has been seen, and a later forward one replaces it.
        let defines = match (reverse, defined) {
            (_, false) => true,
            (true, true) => false,
            (false, true) if from_reverse_record => true,
            (false, true) => {
                let message = || {
                    format!(
                        "Segment '{}' is defined again; the first definition is kept",
                        show(name)
                    )
                };
                b.warn(no, WarningKind::DuplicateSegment, message);
                false
            }
        };
        if defines {
            b.claim(id);
            if reverse {
                b.segments.flags[id as usize] |= seg_flags::SEQ_REVERSED;
            }
            b.segments.depth[id as usize] = cov as f32;
            self.current = Some(Record {
                id,
                offset: None,
                packed_start: b.packed.as_ref().map_or(0, |p| p.start()),
                count: BaseCount::default(),
                line: no,
            });
        }

        for token in neighbours.split(|&c| c == b',').filter(|t| !t.is_empty()) {
            let Some(EdgeName {
                name: other,
                reverse: other_reverse,
                ..
            }) = edge_name(token)
            else {
                let message = || format!("FASTG neighbour is not an EDGE name: '{}'", show(token));
                b.warn(no, WarningKind::Malformed, message);
                continue;
            };
            let Some(other) = b.reference(other, no) else {
                return;
            };
            b.link((id, reverse), (other, other_reverse), Overlap::Unknown, no);
        }
    }

    pub(crate) fn close(&mut self, b: &mut Builder) {
        let Some(record) = self.current.take() else {
            return;
        };
        let i = record.id as usize;
        let name = b.names.get(record.id).to_vec();
        b.segments.length[i] = clamp_length(b, record.count.len, &name, record.line);
        b.segments.gc[i] = record.count.gc_fraction();
        if record.count.len > 0 {
            b.segments.flags[i] |= seg_flags::HAS_SEQ;
            b.segments.seq[i] = match &b.packed {
                Some(_) => record.packed_start,
                None => {
                    b.segments.flags[i] |= seg_flags::SEQ_WRAPPED;
                    record.offset.unwrap_or_default()
                }
            };
        }
    }
}

/// `EDGE_<n>_length_<l>_cov_<c>[']`, named `<n>`.
struct EdgeName<'a> {
    name: &'a [u8],
    reverse: bool,
    parts: Vec<&'a [u8]>,
}

fn edge_name(token: &[u8]) -> Option<EdgeName<'_>> {
    let (token, reverse) = match token.strip_suffix(b"'") {
        Some(t) => (t, true),
        None => (token, false),
    };
    let parts: Vec<&[u8]> = token.splitn(6, |&c| c == b'_').collect();
    let name = *parts.get(1)?;
    if name.is_empty() {
        return None;
    }
    Some(EdgeName {
        name,
        reverse,
        parts,
    })
}
