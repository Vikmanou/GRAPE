//! An index of canonical k-mers over every segment's bases. A seed found here
//! is checked against the packed bases, so hash buckets may be shared.

use crate::store::seq::Packed;

pub use super::build::{INDEX_BUDGET, IndexBuilder, IndexError};

pub const DEFAULT_K: usize = 15;
pub const MIN_K: usize = 8;
pub const MAX_K: usize = 16;
/// k-mers this common in the graph seed nothing, or a repeat would cost more
/// than the rest of the search.
pub const MAX_OCCURRENCES: usize = 4096;

/// Knuth's multiplicative hashing, TAOCP vol. 3.
pub(super) const HASH_MULTIPLIER: u32 = 2_654_435_761;

pub(super) fn bucket_of(canonical: u32, shift: u32) -> usize {
    (canonical.wrapping_mul(HASH_MULTIPLIER) >> shift) as usize
}

fn outside_run(bases: &Packed, first_run: &mut usize, pos: u64) -> bool {
    while let Some(run) = bases.runs.get(*first_run) {
        if run.start + u64::from(run.len) > pos {
            return run.start > pos;
        }
        *first_run += 1;
    }
    true
}

fn code_at(bases: &Packed, pos: u64) -> u32 {
    u32::from(bases.bits[(pos / 4) as usize] >> ((pos % 4) * 2) & 3)
}

/// Every k-mer of a segment without a non-ACGT base, as `(position, canonical)`.
pub(super) fn each_kmer(
    bases: &Packed,
    start: u32,
    length: u32,
    k: usize,
    mut visit: impl FnMut(u32, u32),
) {
    let mask = mask(k);
    let top = 2 * (k as u32 - 1);
    let mut run = bases
        .runs
        .partition_point(|r| r.start + u64::from(r.len) <= u64::from(start));
    let (mut forward, mut reverse, mut valid) = (0u32, 0u32, 0usize);
    for offset in 0..length {
        let pos = u64::from(start) + u64::from(offset);
        if !outside_run(bases, &mut run, pos) {
            valid = 0;
            continue;
        }
        let code = code_at(bases, pos);
        forward = (forward << 2 | code) & mask;
        reverse = reverse >> 2 | (3 - code) << top;
        valid += 1;
        if valid >= k {
            visit(start + offset + 1 - k as u32, forward.min(reverse));
        }
    }
}

fn mask(k: usize) -> u32 {
    if k >= 16 {
        u32::MAX
    } else {
        (1 << (2 * k)) - 1
    }
}

pub struct KmerIndex {
    pub(super) k: usize,
    pub(super) window: u32,
    pub(super) shift: u32,
    pub(super) bases: Packed,
    pub(super) order: Vec<u32>,
    pub(super) order_starts: Vec<u32>,
    pub(super) starts: Vec<u32>,
    pub(super) lengths: Vec<u32>,
    pub(super) buckets: Vec<u32>,
    pub(super) entries: Vec<u32>,
}

/// One place a query k-mer occurs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occurrence {
    pub segment: u32,
    /// Offset from the start of the segment's forward bases.
    pub offset: u32,
    pub reverse: bool,
}

impl KmerIndex {
    pub fn k(&self) -> usize {
        self.k
    }

    /// k-mers per winnowing window; 1 when every k-mer is indexed.
    pub fn window(&self) -> u32 {
        self.window
    }

    /// Exact matches this long or longer are always seeded.
    pub fn guaranteed_match(&self) -> usize {
        self.k + self.window as usize - 1
    }

    pub fn segments(&self) -> usize {
        self.lengths.len()
    }

    pub fn length(&self, segment: u32) -> u32 {
        self.lengths.get(segment as usize).copied().unwrap_or(0)
    }

    pub fn indexed_segments(&self) -> usize {
        self.order.len()
    }

    pub fn indexed_bases(&self) -> u64 {
        self.bases.bases
    }

    pub fn heap_bytes(&self) -> usize {
        self.bases.heap_bytes()
            + (self.order.capacity() + self.order_starts.capacity()) * 4
            + (self.starts.capacity() + self.lengths.capacity()) * 4
            + (self.buckets.capacity() + self.entries.capacity()) * 4
    }

    /// A range of a segment's bases, uppercase, on the strand asked for, in
    /// that strand's own coordinates.
    pub fn oriented(&self, segment: u32, reverse: bool, from: u32, to: u32) -> Vec<u8> {
        let length = self.length(segment);
        let to = to.min(length);
        let from = from.min(to);
        let start = u64::from(self.starts[segment as usize]);
        if !reverse {
            return self
                .bases
                .decode(start + u64::from(from), u64::from(to - from));
        }
        let mut out = self
            .bases
            .decode(start + u64::from(length - to), u64::from(to - from));
        out.reverse();
        for b in &mut out {
            *b = complement(*b);
        }
        out
    }

    fn kmer_at(&self, pos: u32) -> u32 {
        (u64::from(pos)..u64::from(pos) + self.k as u64)
            .fold(0, |kmer, p| kmer << 2 | code_at(&self.bases, p))
    }

    fn place(&self, pos: u32, reverse: bool) -> Occurrence {
        let i = self.order_starts.partition_point(|&s| s <= pos) - 1;
        Occurrence {
            segment: self.order[i],
            offset: pos - self.order_starts[i],
            reverse,
        }
    }

    /// Every indexed place of a k-mer on either strand, or `None` past
    /// `MAX_OCCURRENCES`.
    pub fn occurrences(&self, forward: u32, reverse: u32, out: &mut Vec<Occurrence>) -> Option<()> {
        out.clear();
        let bucket = bucket_of(forward.min(reverse), self.shift);
        let range = self.buckets[bucket] as usize..self.buckets[bucket + 1] as usize;
        for &pos in &self.entries[range] {
            let kmer = self.kmer_at(pos);
            if kmer == forward {
                out.push(self.place(pos, false));
            }
            if kmer == reverse {
                out.push(self.place(pos, true));
            }
            if out.len() > MAX_OCCURRENCES {
                return None;
            }
        }
        Some(())
    }
}

pub(crate) fn complement(b: u8) -> u8 {
    match b {
        b'A' => b'T',
        b'C' => b'G',
        b'G' => b'C',
        b'T' => b'A',
        other => other,
    }
}

/// `(position, forward, reverse complement)` of each ACGT k-mer of a query.
pub fn query_kmers(query: &[u8], k: usize, mut visit: impl FnMut(usize, u32, u32)) {
    let mask = mask(k);
    let top = 2 * (k as u32 - 1);
    let (mut forward, mut reverse, mut valid) = (0u32, 0u32, 0usize);
    for (i, &b) in query.iter().enumerate() {
        let code = match b {
            b'A' => 0,
            b'C' => 1,
            b'G' => 2,
            b'T' => 3,
            _ => {
                valid = 0;
                continue;
            }
        };
        forward = (forward << 2 | code) & mask;
        reverse = reverse >> 2 | (3 - code) << top;
        valid += 1;
        if valid >= k {
            visit(i + 1 - k, forward, reverse);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(segments: &[&[u8]], k: usize, budget: u64) -> KmerIndex {
        let mut b = IndexBuilder::with_budget(segments.len(), k, budget);
        for (i, bases) in segments.iter().enumerate() {
            b.add(i as u32, bases).unwrap();
        }
        b.plan().unwrap();
        while !b.step(16).unwrap() {}
        b.finish()
    }

    fn places(index: &KmerIndex, kmer: &[u8]) -> Vec<(u32, u32, bool)> {
        let mut places = Vec::new();
        query_kmers(kmer, index.k(), |_, forward, reverse| {
            let mut out = Vec::new();
            index.occurrences(forward, reverse, &mut out).unwrap();
            places.extend(out.iter().map(|o| (o.segment, o.offset, o.reverse)));
        });
        places.sort_unstable();
        places
    }

    #[test]
    fn both_strands_match_and_kmers_stay_inside_segments() {
        let i = index(&[b"AACCGGTTAG", b"ctaaccg"], 8, INDEX_BUDGET);
        assert_eq!(places(&i, b"AACCGGTT"), [(0, 0, false), (0, 0, true)]);
        assert_eq!(places(&i, b"CTAACCGG"), [(0, 2, true)]);
        assert!(places(&i, b"GCTAACCG").is_empty());
        assert_eq!(i.oriented(1, true, 0, 3), b"CGG");
        assert_eq!(i.oriented(1, false, 5, 99), b"CG");
    }

    #[test]
    fn non_acgt_bases_are_never_seeded() {
        let i = index(&[b"AAAACCCCNGGGGTTTTACGT"], 8, INDEX_BUDGET);
        assert!(places(&i, b"AACCCCNG").is_empty());
        assert_eq!(places(&i, b"GGGGTTTT"), [(0, 0, true), (0, 9, false)]);
    }

    /// xorshift, so the sequence is the same on every run.
    fn random_bases(n: usize) -> Vec<u8> {
        let mut x = 0x2545_f491_u32;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                b"ACGT"[(x >> 7 & 3) as usize]
            })
            .collect()
    }

    #[test]
    fn past_the_budget_every_long_enough_exact_match_still_holds_a_minimizer() {
        let bases = random_bases(20_000);
        let i = index(&[&bases], 15, 40_000);
        assert!(i.window() > 1);
        assert!(i.heap_bytes() < 120_000);
        let n = i.guaranteed_match();
        for start in (0..bases.len() - n).step_by(97) {
            assert!(
                places(&i, &bases[start..start + n])
                    .iter()
                    .any(|&(_, offset, _)| (offset as usize) >= start
                        && (offset as usize) < start + n),
                "nothing seeds {start}"
            );
        }
    }
}
