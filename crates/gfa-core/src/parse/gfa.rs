//! GFA 1.0/1.1 records, per <https://github.com/GFA-spec/GFA-spec/blob/master/GFA1.md>.
//! Depth tags follow Bandage's `buildDeBruijnGraphFromGfa`
//! (<https://github.com/rrwick/Bandage/blob/main/graph/assemblygraph.cpp>).

use crate::parse::builder::Builder;
use crate::parse::fields::{self, Overlap};
use crate::parse::warnings::{FatalError, WarningKind, show};
use crate::store::paths::{PathKind, REVERSE, walk_steps};
use crate::store::seg_flags;
use crate::store::seq::BaseCount;

/// `offset` is the file offset of the line's first byte.
pub(crate) fn line(b: &mut Builder, line: &[u8], offset: u64, no: u64) {
    let mut fields = fields::tabs(line);
    let kind = fields.next().unwrap_or_default();
    match kind {
        b"" => {}
        b"S" => segment(b, line, fields, offset, no),
        b"L" => link(b, fields, no),
        b"P" => path(b, fields, no),
        b"W" => walk(b, fields, no),
        b"C" => containment(b, fields, no),
        b"H" => header(b, fields, no),
        b"E" | b"F" | b"G" | b"O" | b"U" => b.fatal = Some(FatalError::Gfa2 { line: no }),
        _ if kind[0] == b'#' => {}
        _ => b.unknown_record(kind[0], no),
    }
}

fn malformed(b: &mut Builder, no: u64, what: &str) {
    b.warn(no, WarningKind::Malformed, || what.to_owned());
}

fn malformed_tag(b: &mut Builder, no: u64, what: &str, field: &[u8]) {
    b.warn(no, WarningKind::MalformedTag, || {
        format!("{what}: '{}'", show(field))
    });
}

fn header<'a>(b: &mut Builder, fields: impl Iterator<Item = &'a [u8]>, no: u64) {
    for field in fields {
        let Some(tag) = fields::tag(field) else {
            malformed_tag(b, no, "Malformed tag", field);
            continue;
        };
        if &tag.name == b"VN" {
            if tag.value.starts_with(b"2") {
                b.fatal = Some(FatalError::Gfa2 { line: no });
            }
            b.version = Some(show(tag.value));
        }
    }
}

#[derive(Default)]
struct SegmentTags {
    ln: Option<u64>,
    dp: Option<f64>,
    kc: Option<f64>,
    rc: Option<f64>,
    fc: Option<f64>,
}

fn segment<'a>(
    b: &mut Builder,
    line: &[u8],
    mut fields: impl Iterator<Item = &'a [u8]>,
    offset: u64,
    no: u64,
) {
    let (Some(name), Some(seq)) = (fields.next(), fields.next()) else {
        return malformed(b, no, "S line needs a name and a sequence (or *)");
    };
    if name.is_empty() || seq.is_empty() {
        return malformed(b, no, "S line has an empty name or sequence");
    }

    let mut tags = SegmentTags::default();
    for field in fields {
        let Some(tag) = fields::tag(field) else {
            malformed_tag(b, no, "Malformed tag", field);
            continue;
        };
        // Bandage upper-cases tag names, so `dp` counts as `DP`.
        let slot = match tag.name.map(|c| c.to_ascii_uppercase()) {
            [b'L', b'N'] => {
                match fields::unsigned(tag.value) {
                    Some(v) => tags.ln = Some(v),
                    None => malformed_tag(b, no, "LN is not a length", field),
                }
                continue;
            }
            [b'D', b'P'] => &mut tags.dp,
            [b'K', b'C'] => &mut tags.kc,
            [b'R', b'C'] => &mut tags.rc,
            [b'F', b'C'] => &mut tags.fc,
            _ => continue,
        };
        match fields::number(tag.value) {
            Some(v) => *slot = Some(v),
            None => malformed_tag(b, no, "Tag is not a number", field),
        }
    }

    let Some(id) = b.define(name, no) else {
        return;
    };
    b.segments.set_line(id, offset);
    let i = id as usize;

    let length = if seq == b"*" {
        tags.ln.unwrap_or_else(|| {
            b.warn(no, WarningKind::MissingLength, || {
                format!(
                    "Segment '{}' has no sequence and no LN tag; its length is 0",
                    show(name)
                )
            });
            0
        })
    } else {
        let mut count = BaseCount::default();
        count.add(seq);
        if let Some(ln) = tags.ln
            && ln != count.len
        {
            b.warn(no, WarningKind::LengthMismatch, || {
                format!(
                    "Segment '{}' has LN:i:{ln} but a sequence of {} bases",
                    show(name),
                    count.len
                )
            });
        }
        b.segments.gc[i] = count.gc_fraction();
        b.segments.flags[i] |= seg_flags::HAS_SEQ;
        b.segments.seq[i] = match &mut b.packed {
            None => offset + (seq.as_ptr() as usize - line.as_ptr() as usize) as u64,
            Some(packed) => {
                let start = packed.start();
                if !packed.append(seq) {
                    sequences_dropped(b, no);
                }
                start
            }
        };
        count.len
    };
    b.segments.length[i] = clamp_length(b, length, name, no);
    b.segments.depth[i] = depth(&tags, length);
}

pub(crate) fn sequences_dropped(b: &mut Builder, no: u64) {
    b.warn(no, WarningKind::SequencesDropped, || {
        "Sequences exceed the memory budget and were dropped; sequence search is disabled"
            .to_owned()
    });
}

/// Bandage's rule: DP, else KC, RC or FC divided by length.
fn depth(tags: &SegmentTags, length: u64) -> f32 {
    if let Some(dp) = tags.dp {
        return dp as f32;
    }
    match tags.kc.or(tags.rc).or(tags.fc) {
        Some(c) if length > 0 => (c / length as f64) as f32,
        _ => f32::NAN,
    }
}

pub(crate) fn clamp_length(b: &mut Builder, length: u64, name: &[u8], no: u64) -> u32 {
    u32::try_from(length).unwrap_or_else(|_| {
        b.warn(no, WarningKind::SegmentTooLong, || {
            format!(
                "Segment '{}' is longer than 4 Gb; its length is capped",
                show(name)
            )
        });
        u32::MAX
    })
}

fn link<'a>(b: &mut Builder, mut fields: impl Iterator<Item = &'a [u8]>, no: u64) {
    let (Some(a), Some(ao), Some(c), Some(co)) =
        (fields.next(), fields.next(), fields.next(), fields.next())
    else {
        return malformed(
            b,
            no,
            "L line needs from, orientation, to, orientation and overlap",
        );
    };
    let (Some(a_rev), Some(c_rev)) = (fields::orientation(ao), fields::orientation(co)) else {
        return malformed(b, no, "L line orientation is not + or -");
    };
    if a.is_empty() || c.is_empty() {
        return malformed(b, no, "L line has an empty segment name");
    }
    // A missing overlap column is read as `*` rather than dropping the link.
    let overlap = match fields.next().map(fields::overlap) {
        None => Overlap::Unknown,
        Some(Some(o)) => o,
        Some(None) => {
            malformed(b, no, "L line overlap is not * or a CIGAR; read as *");
            Overlap::Unknown
        }
    };
    let (Some(from), Some(to)) = (b.reference(a, no), b.reference(c, no)) else {
        return;
    };
    b.link((from, a_rev), (to, c_rev), overlap, no);
}

fn containment<'a>(b: &mut Builder, fields: impl Iterator<Item = &'a [u8]>, no: u64) {
    if fields.count() < 6 {
        return malformed(
            b,
            no,
            "C line needs container, orientation, contained, orientation, position and overlap",
        );
    }
    b.counts.containments += 1;
}

fn path<'a>(b: &mut Builder, mut fields: impl Iterator<Item = &'a [u8]>, no: u64) {
    let (Some(name), Some(segs)) = (fields.next(), fields.next()) else {
        return malformed(b, no, "P line needs a name and a segment list");
    };
    if name.is_empty() {
        return malformed(b, no, "P line has an empty name");
    }
    for step in segs.split(|&c| c == b',') {
        let parsed = match step.split_last() {
            Some((o, seg)) if !seg.is_empty() => {
                fields::orientation(std::slice::from_ref(o)).map(|r| (seg, r))
            }
            _ => None,
        };
        let Some((seg, reverse)) = parsed else {
            b.paths.discard_pending();
            return malformed(
                b,
                no,
                "P line step is not a segment name followed by + or -",
            );
        };
        if !push_step(b, seg, reverse, no) {
            return;
        }
    }
    commit_path(b, name, PathKind::Path);
}

fn walk<'a>(b: &mut Builder, mut fields: impl Iterator<Item = &'a [u8]>, no: u64) {
    let parts: [Option<&[u8]>; 6] = std::array::from_fn(|_| fields.next());
    let [
        Some(sample),
        Some(hap),
        Some(seqid),
        Some(start),
        Some(end),
        Some(walk),
    ] = parts
    else {
        return malformed(
            b,
            no,
            "W line needs sample, haplotype, sequence id, start, end and walk",
        );
    };
    let Some(steps) = walk_steps(walk) else {
        return malformed(
            b,
            no,
            "W line walk is not a list of >segment or <segment steps",
        );
    };
    for (seg, reverse) in steps {
        if !push_step(b, seg, reverse, no) {
            return;
        }
    }
    let mut name = [sample, hap, seqid].join(&b'#');
    if start != b"*" && end != b"*" {
        name.extend_from_slice(b":");
        name.extend_from_slice(start);
        name.extend_from_slice(b"-");
        name.extend_from_slice(end);
    }
    commit_path(b, &name, PathKind::Walk);
}

fn push_step(b: &mut Builder, seg: &[u8], reverse: bool, no: u64) -> bool {
    let Some(id) = b.reference(seg, no) else {
        b.paths.discard_pending();
        return false;
    };
    b.paths.steps.push(id | if reverse { REVERSE } else { 0 });
    true
}

fn commit_path(b: &mut Builder, name: &[u8], kind: PathKind) {
    if b.paths.finish_path(name, kind).is_err() {
        b.fatal = Some(FatalError::TooLarge);
    }
}
