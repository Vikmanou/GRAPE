use crate::fields::Overlap;
use crate::names::{MAX_ID, Names};
use crate::paths::Paths;
use crate::seq::{Packed, SeqMode};
use crate::store::{LinkInsert, Links, Segments, seg_flags};
use crate::warnings::{FatalError, WarningKind, Warnings, show};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RecordCounts {
    pub containments: u64,
    pub duplicate_links: u64,
    /// Mirror lines that gave the overlap on their own segment (miniasm, hifiasm).
    pub per_strand_overlaps: u64,
}

/// One warning for many lines.
#[derive(Debug, Clone, Copy)]
struct Tally {
    first_line: u64,
    count: u64,
}

impl Tally {
    fn bump(slot: &mut Option<Tally>, line: u64) {
        match slot {
            Some(t) => t.count += 1,
            None => {
                *slot = Some(Tally {
                    first_line: line,
                    count: 1,
                })
            }
        }
    }
}

pub(crate) struct Builder {
    pub names: Names,
    pub segments: Segments,
    pub links: Links,
    pub paths: Paths,
    pub packed: Option<Packed>,
    pub warnings: Warnings,
    pub counts: RecordCounts,
    pub version: Option<String>,
    pub fatal: Option<FatalError>,
    /// The line that first named each segment, for reporting the ones never
    /// defined. Indexed by id, dropped once parsing ends.
    first_reference: Vec<u64>,
    unknown: Vec<(u8, Tally)>,
    complex_overlaps: Option<Tally>,
    /// The segment defined last. L lines usually follow the S line of the
    /// segment they leave, so this skips a hash probe for most From names.
    last_name: Vec<u8>,
    last_id: Option<u32>,
}

impl Builder {
    pub(crate) fn new(mode: SeqMode) -> Self {
        Self {
            names: Names::default(),
            segments: Segments::default(),
            links: Links::default(),
            paths: Paths::default(),
            packed: match mode {
                SeqMode::FileOffsets => None,
                SeqMode::Packed { budget_bytes } => Some(Packed::new(budget_bytes)),
            },
            warnings: Warnings::default(),
            counts: RecordCounts::default(),
            version: None,
            fatal: None,
            first_reference: Vec::new(),
            unknown: Vec::new(),
            complex_overlaps: None,
            last_name: Vec::new(),
            last_id: None,
        }
    }

    pub(crate) fn warn(&mut self, line: u64, kind: WarningKind, message: impl FnOnce() -> String) {
        self.warnings.push(line, kind, message);
    }

    pub(crate) fn segment_id(&mut self, name: &[u8]) -> Option<(u32, bool)> {
        if let Some(id) = self.last_id
            && self.last_name == name
        {
            return Some((id, false));
        }
        match self.names.intern(name) {
            Ok((id, new)) => {
                if new {
                    self.segments.push_placeholder();
                    self.first_reference.push(0);
                }
                Some((id, new))
            }
            Err(_) => {
                self.fatal = Some(FatalError::TooLarge);
                None
            }
        }
    }

    pub(crate) fn reference(&mut self, name: &[u8], line: u64) -> Option<u32> {
        let (id, new) = self.segment_id(name)?;
        if new {
            self.first_reference[id as usize] = line;
        }
        Some(id)
    }

    /// `None` if the segment was already defined.
    pub(crate) fn define(&mut self, name: &[u8], line: u64) -> Option<u32> {
        let (id, new) = self.segment_id(name)?;
        if !new && self.segments.is_defined(id) {
            self.warn(line, WarningKind::DuplicateSegment, || {
                format!(
                    "Segment '{}' is defined again; the first definition is kept",
                    show(name)
                )
            });
            return None;
        }
        self.claim(id);
        self.last_name.clear();
        self.last_name.extend_from_slice(name);
        self.last_id = Some(id);
        Some(id)
    }

    pub(crate) fn claim(&mut self, id: u32) {
        self.segments.flags[id as usize] = seg_flags::DEFINED;
    }

    pub(crate) fn link(&mut self, from: (u32, bool), to: (u32, bool), overlap: Overlap, line: u64) {
        if self.links.len() >= MAX_ID as usize {
            self.fatal = Some(FatalError::TooLarge);
            return;
        }
        if let Overlap::Cigar(c) = overlap
            && !c.simple
        {
            Tally::bump(&mut self.complex_overlaps, line);
        }
        match self.links.insert(from, to, overlap) {
            LinkInsert::New => {}
            LinkInsert::Duplicate => self.counts.duplicate_links += 1,
            LinkInsert::PerStrand => self.counts.per_strand_overlaps += 1,
            LinkInsert::Conflict => {
                let (a, b) = (show(self.names.get(from.0)), show(self.names.get(to.0)));
                let (sa, sb) = (sign(from.1), sign(to.1));
                self.warn(
                    line,
                    WarningKind::OverlapConflict,
                    || format!("Link {a}{sa} {b}{sb} repeats an earlier link with a different overlap; the first is kept"),
                );
            }
        }
    }

    pub(crate) fn unknown_record(&mut self, kind: u8, line: u64) {
        match self.unknown.iter_mut().find(|(k, _)| *k == kind) {
            Some((_, t)) => t.count += 1,
            None => self.unknown.push((
                kind,
                Tally {
                    first_line: line,
                    count: 1,
                },
            )),
        }
    }

    pub(crate) fn close(&mut self) {
        let first_reference = std::mem::take(&mut self.first_reference);
        for (id, line) in (0..).zip(first_reference) {
            if self.segments.is_defined(id) {
                continue;
            }
            let name = show(self.names.get(id));
            self.warn(line, WarningKind::UndefinedSegment, || {
                format!("Segment '{name}' is referenced but never defined")
            });
        }
        for (kind, t) in std::mem::take(&mut self.unknown) {
            let shown = show(&[kind]);
            self.warn(t.first_line, WarningKind::UnknownRecord, || {
                format!(
                    "Ignored {} line(s) of unknown record type '{shown}'",
                    t.count
                )
            });
        }
        if let Some(t) = self.complex_overlaps.take() {
            self.warn(t.first_line, WarningKind::ComplexOverlap, || {
                format!(
                    "{} link(s) have CIGARs with indels or clipping; their overlap is approximate",
                    t.count
                )
            });
        }
        self.warnings.list.sort_by_key(|w| w.line);
        self.links.seal();
    }
}

pub(crate) fn sign(reverse: bool) -> char {
    if reverse { '-' } else { '+' }
}
