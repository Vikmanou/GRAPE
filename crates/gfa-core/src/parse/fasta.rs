//! Sequences from a FASTA file for a graph whose `S` lines give `*`, as
//! ABySS writes them. Records match segments by name, the header's first
//! word, and are read back from the file (plain) or packed (gzipped).

use crate::analysis::{components, stats};
use crate::store::graph::Graph;
use crate::store::seg_flags;
use crate::store::seq::{BaseCount, DEFAULT_BUDGET, Packed};

#[derive(Debug, Default)]
struct Record {
    name: Vec<u8>,
    /// File offset of its first base, or its first packed base.
    start: Option<u64>,
    count: BaseCount,
    lines: u32,
}

/// Streams a FASTA file in chunks of any size.
#[derive(Debug, Default)]
pub struct FastaIndexer {
    packed: Option<Packed>,
    carry: Vec<u8>,
    /// File offset of the first byte of `carry`.
    offset: u64,
    records: Vec<Record>,
}

/// What attaching a FASTA file to a graph did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Attached {
    pub matched: u64,
    /// Records naming no segment of the graph.
    pub unknown: u64,
    /// Segments whose `LN` the record's length replaced.
    pub resized: u64,
    pub dropped: bool,
}

impl FastaIndexer {
    /// `packed` keeps the bases, for input that cannot be read at an offset.
    pub fn new(packed: bool) -> Self {
        Self {
            packed: packed.then(|| Packed::new(DEFAULT_BUDGET)),
            ..Self::default()
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        let mut rest = chunk;
        while let Some(newline) = rest.iter().position(|&b| b == b'\n') {
            let carried = self.carry.len() as u64;
            if carried == 0 {
                self.line(&rest[..newline], self.offset);
            } else {
                let mut line = std::mem::take(&mut self.carry);
                line.extend_from_slice(&rest[..newline]);
                self.line(&line, self.offset);
            }
            self.offset += carried + newline as u64 + 1;
            rest = &rest[newline + 1..];
        }
        self.carry.extend_from_slice(rest);
    }

    fn line(&mut self, line: &[u8], offset: u64) {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if let Some(header) = line.strip_prefix(b">") {
            let name = header
                .split(|b| b.is_ascii_whitespace())
                .next()
                .unwrap_or(&[]);
            self.records.push(Record {
                name: name.to_vec(),
                ..Record::default()
            });
            return;
        }
        let Some(record) = self.records.last_mut() else {
            return;
        };
        let bases = line.trim_ascii();
        if bases.is_empty() {
            return;
        }
        if record.start.is_none() {
            record.start = Some(match &self.packed {
                Some(p) => p.start(),
                None => offset + (bases.as_ptr() as usize - line.as_ptr() as usize) as u64,
            });
        }
        record.count.add(bases);
        record.lines += 1;
        if let Some(p) = &mut self.packed {
            p.append(bases);
        }
    }

    /// Gives each named segment its record's sequence, length and GC, then
    /// recounts what depends on lengths.
    pub fn attach(mut self, g: &mut Graph) -> Attached {
        let tail = std::mem::take(&mut self.carry);
        self.line(&tail, self.offset);
        let mut out = Attached {
            dropped: self.packed.as_ref().is_some_and(|p| p.dropped),
            ..Attached::default()
        };
        let s = &mut g.segments;
        for record in &self.records {
            let (Some(id), Some(start)) = (g.names.find(&record.name), record.start) else {
                out.unknown += 1;
                continue;
            };
            if out.dropped || !s.is_defined(id) {
                out.unknown += u64::from(!s.is_defined(id));
                continue;
            }
            let i = id as usize;
            let length = u32::try_from(record.count.len).unwrap_or(u32::MAX);
            out.resized += u64::from(s.length[i] != length);
            s.length[i] = length;
            s.seq[i] = start;
            s.gc[i] = record.count.gc_fraction();
            s.flags[i] = seg_flags::DEFINED
                | seg_flags::HAS_SEQ
                | if record.lines > 1 {
                    seg_flags::SEQ_WRAPPED
                } else {
                    0
                };
            out.matched += 1;
        }
        g.packed = self.packed.filter(|p| !p.dropped);
        g.components = components::compute(&mut g.segments, &g.links);
        components::describe(&mut g.components, &g.segments, &g.adjacency);
        g.stats = stats::compute(&g.segments, &g.adjacency, &g.components, g.links.len());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, bases_from_file, bases_from_packed, parse};

    const GFA: &[u8] = b"S\ta\t*\tLN:i:6\nS\tb\t*\tLN:i:3\nS\tc\t*\nL\ta\t+\tb\t+\t0M\n";
    const FASTA: &[u8] = b">a first\nACG\nTac\n>z\nAAAA\n>b\r\nGGC\r\n";

    fn attached(packed: bool, cuts: &[usize]) -> (Graph, Attached) {
        let mut g = parse(GFA, ParseOptions::default()).unwrap();
        let mut indexer = FastaIndexer::new(packed);
        let mut start = 0;
        for &cut in cuts.iter().chain([&FASTA.len()]) {
            indexer.push(&FASTA[start..cut]);
            start = cut;
        }
        let report = indexer.attach(&mut g);
        (g, report)
    }

    #[test]
    fn records_give_segments_their_bases_wherever_chunks_break() {
        for cuts in [&[][..], &[1, 9, 10, 20], &[5, 6, 7, 8, 9, 10, 11, 12]] {
            let (g, report) = attached(false, cuts);
            assert_eq!(
                report,
                Attached {
                    matched: 2,
                    unknown: 1,
                    resized: 0,
                    dropped: false
                }
            );
            let a = g.names.find(b"a").unwrap() as usize;
            let b = g.names.find(b"b").unwrap() as usize;
            let bytes = |i: usize| &FASTA[g.segments.seq[i] as usize..];
            assert_eq!(
                bases_from_file(bytes(a), 6, g.segments.flags[a]).unwrap(),
                b"ACGTac"
            );
            assert_eq!(
                bases_from_file(bytes(b), 3, g.segments.flags[b]).unwrap(),
                b"GGC"
            );
            assert!((g.segments.gc[a] - 0.5).abs() < 1e-6);
            assert!(g.stats.gc.is_finite());
        }
    }

    #[test]
    fn gzipped_input_packs_the_bases() {
        let (g, _) = attached(true, &[]);
        let a = g.names.find(b"a").unwrap() as usize;
        let packed = g.packed.as_ref().unwrap();
        assert_eq!(
            bases_from_packed(packed, g.segments.seq[a], 6, 0).unwrap(),
            b"ACGTac"
        );
    }
}
