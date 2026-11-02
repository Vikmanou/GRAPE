//! From a query's k-mers to the alignments they lead to, one segment and
//! strand at a time.

use super::align::{Alignment, align};
use super::kmer::{KmerIndex, Occurrence, query_kmers};

/// Half width of the alignment band beyond the seeds' diagonals, so a hit
/// holds indels of up to this many bases more than its seeds show.
pub const BAND: i64 = 64;
/// Seeds on diagonals further apart than this align separately.
const MAX_SPAN: i64 = 4096;
const MAX_SEEDS: usize = 16_000_000;
/// Alignments asked of one cluster of seeds, against a repeat's many diagonals.
const MAX_REGIONS: usize = 32;

/// Queries that need fewer bases than this cannot score a seed's worth.
pub fn min_score(query_length: usize) -> i32 {
    (2 * query_length).min(40) as i32
}

/// What a search left out, to tell the user.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Skipped {
    /// Query k-mers past `MAX_OCCURRENCES`.
    pub repeats: u64,
    /// Seeds past `MAX_SEEDS`.
    pub seeds: bool,
}

/// One alignment on one strand of one segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Part {
    pub segment: u32,
    /// The query reads the segment's reverse complement.
    pub reverse: bool,
    pub q_start: u32,
    pub q_end: u32,
    /// On the strand the query reads, from that strand's start.
    pub t_start: u32,
    pub t_end: u32,
    pub score: i32,
    pub matches: u32,
    pub columns: u32,
}

#[derive(Clone, Copy)]
struct Seed {
    segment: u32,
    reverse: bool,
    diagonal: i64,
    q: u32,
}

fn collect_seeds(index: &KmerIndex, query: &[u8], skipped: &mut Skipped) -> Vec<Seed> {
    let k = index.k() as u32;
    let mut seeds = Vec::new();
    let mut places: Vec<Occurrence> = Vec::new();
    query_kmers(query, index.k(), |q, forward, reverse| {
        if seeds.len() >= MAX_SEEDS {
            skipped.seeds = true;
            return;
        }
        if index.occurrences(forward, reverse, &mut places).is_none() {
            skipped.repeats += 1;
            return;
        }
        for place in &places {
            let t = if place.reverse {
                index.length(place.segment) - place.offset - k
            } else {
                place.offset
            };
            seeds.push(Seed {
                segment: place.segment,
                reverse: place.reverse,
                diagonal: i64::from(t) - q as i64,
                q: q as u32,
            });
        }
    });
    seeds
}

/// Every alignment of `query`, uppercase, that a seed leads to and that scores
/// at least `min_score`, with no two the same.
pub fn segment_hits(index: &KmerIndex, query: &[u8], skipped: &mut Skipped) -> Vec<Part> {
    let mut seeds = collect_seeds(index, query, skipped);
    seeds.sort_unstable_by_key(|s| (s.segment, s.reverse, s.diagonal, s.q));
    let threshold = min_score(query.len());
    let mut parts = Vec::new();
    let mut group = 0;
    while group < seeds.len() {
        let first = seeds[group];
        let same = seeds[group..]
            .partition_point(|s| (s.segment, s.reverse) == (first.segment, first.reverse));
        let strand = &seeds[group..group + same];
        let aligner = Strand {
            index,
            query,
            segment: first.segment,
            reverse: first.reverse,
            threshold,
        };
        let mut found = Vec::new();
        let mut start = 0;
        for end in 1..=strand.len() {
            let splits = end == strand.len()
                || strand[end].diagonal - strand[end - 1].diagonal > BAND
                || strand[end].diagonal - strand[start].diagonal > MAX_SPAN;
            if splits {
                aligner.cluster(&strand[start..end], &mut found);
                start = end;
            }
        }
        found.sort_unstable_by_key(|a| (a.q_start, a.t_start, a.q_end, a.t_end));
        found.dedup();
        parts.extend(found.iter().map(|a| aligner.part(a)));
        group += same;
    }
    parts
}

struct Strand<'a> {
    index: &'a KmerIndex,
    query: &'a [u8],
    segment: u32,
    reverse: bool,
    threshold: i32,
}

impl Strand<'_> {
    fn part(&self, a: &Alignment) -> Part {
        Part {
            segment: self.segment,
            reverse: self.reverse,
            q_start: a.q_start,
            q_end: a.q_end,
            t_start: a.t_start,
            t_end: a.t_end,
            score: a.score,
            matches: a.matches,
            columns: a.columns,
        }
    }

    /// The best alignment in the seeds' band, then again for seeds left
    /// outside it: on either side of it in the query, or on other diagonals.
    fn cluster(&self, seeds: &[Seed], out: &mut Vec<Alignment>) {
        let mut regions = vec![(0u32, self.query.len() as u32, seeds.to_vec())];
        let mut asked = 0;
        while let Some((q_from, q_to, seeds)) = regions.pop() {
            asked += 1;
            if asked > MAX_REGIONS {
                return;
            }
            let Some(found) = self.region(q_from, q_to, &seeds) else {
                continue;
            };
            let (mut before, mut after, mut across) = (Vec::new(), Vec::new(), Vec::new());
            let k = self.index.k() as u32;
            for &seed in &seeds {
                let t = seed.diagonal + i64::from(seed.q);
                if seed.q + k <= found.q_start {
                    before.push(seed);
                } else if seed.q >= found.q_end {
                    after.push(seed);
                } else if t + i64::from(k) <= i64::from(found.t_start)
                    || t >= i64::from(found.t_end)
                {
                    across.push(seed);
                }
            }
            out.push(found);
            for (from, to, rest) in [
                (q_from, found.q_start, before),
                (found.q_end, q_to, after),
                (q_from, q_to, across),
            ] {
                if !rest.is_empty() && rest.len() < seeds.len() {
                    regions.push((from, to, rest));
                }
            }
        }
    }

    fn region(&self, q_from: u32, q_to: u32, seeds: &[Seed]) -> Option<Alignment> {
        let lo = seeds.iter().map(|s| s.diagonal).min()? - BAND;
        let hi = seeds.iter().map(|s| s.diagonal).max()? + BAND;
        let length = i64::from(self.index.length(self.segment));
        let from = (lo + i64::from(q_from)).clamp(0, length) as u32;
        let to = (hi + i64::from(q_to)).clamp(0, length) as u32;
        let target = self.index.oriented(self.segment, self.reverse, from, to);
        let q_shift = i64::from(q_from);
        let query = &self.query[q_from as usize..q_to as usize];
        let mut found = align(query, &target, from, lo + q_shift, hi + q_shift)?;
        found.q_start += q_from;
        found.q_end += q_from;
        (found.score >= self.threshold).then_some(found)
    }
}
