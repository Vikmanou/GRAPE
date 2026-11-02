//! An index of canonical k-mers over every segment's bases. A seed found here
//! is checked against the packed bases, so hash buckets may be shared.

use crate::store::seq::Packed;
use std::collections::VecDeque;

pub const DEFAULT_K: usize = 15;
pub const MIN_K: usize = 8;
pub const MAX_K: usize = 16;
/// Bytes of buckets and entries; larger graphs index minimizers only.
pub const INDEX_BUDGET: u64 = 1 << 30;
/// k-mers this common in the graph seed nothing, or a repeat would cost more
/// than the rest of the search.
pub const MAX_OCCURRENCES: usize = 4096;
const BUCKET_LOAD: u64 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexError {
    TooManyBases,
    OutOfMemory,
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::TooManyBases => "The graph has too many bases to index for sequence search.",
            Self::OutOfMemory => "There is not enough memory to index the graph's sequences.",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Count,
    Fill,
    Done,
}

pub struct IndexBuilder {
    k: usize,
    budget: u64,
    bases: Packed,
    /// In the order segments were added, which is ascending position.
    order: Vec<u32>,
    starts: Vec<u32>,
    lengths: Vec<u32>,
    window: u32,
    shift: u32,
    buckets: Vec<u32>,
    entries: Vec<u32>,
    phase: Phase,
    cursor: usize,
    done_bases: u64,
}

impl IndexBuilder {
    pub fn new(segments: usize, k: usize) -> Self {
        Self::with_budget(segments, k, INDEX_BUDGET)
    }

    pub fn with_budget(segments: usize, k: usize, budget: u64) -> Self {
        Self {
            k: k.clamp(MIN_K, MAX_K),
            budget,
            bases: Packed::new(u64::from(u32::MAX) / 4),
            order: Vec::new(),
            starts: vec![0; segments],
            lengths: vec![0; segments],
            window: 1,
            shift: 0,
            buckets: Vec::new(),
            entries: Vec::new(),
            phase: Phase::Count,
            cursor: 0,
            done_bases: 0,
        }
    }

    /// Segments may come in any order, each at most once.
    pub fn add(&mut self, segment: u32, bases: &[u8]) -> Result<(), IndexError> {
        let i = segment as usize;
        if i >= self.lengths.len() || bases.is_empty() {
            return Ok(());
        }
        let start = self.bases.start();
        if !self.bases.append(&bases.to_ascii_uppercase()) {
            return Err(IndexError::TooManyBases);
        }
        self.order.push(segment);
        self.starts[i] = start as u32;
        self.lengths[i] = bases.len() as u32;
        Ok(())
    }

    /// Sizes the index once every segment is added.
    pub fn plan(&mut self) -> Result<(), IndexError> {
        let bases = self.bases.bases.max(1);
        let fits = |entries: u64| 4 * entries + 4 * (entries / BUCKET_LOAD).max(1) <= self.budget;
        // Winnowing keeps about 2 / (w + 1) of the k-mers.
        let kept = |window: u32| bases * 2 / (u64::from(window) + 1);
        let mut window = 1;
        if !fits(bases) {
            window = 3;
            while !fits(kept(window)) && window < 1 << 16 {
                window = window * 2 + 1;
            }
        }
        self.window = window;
        let expected = if window == 1 { bases } else { kept(window) };
        let bits = (expected / BUCKET_LOAD)
            .max(256)
            .next_power_of_two()
            .ilog2();
        self.shift = 32 - bits;
        reserve(&mut self.buckets, (1usize << bits) + 1)?;
        self.buckets.resize((1 << bits) + 1, 0);
        Ok(())
    }

    /// Does about `bases` bases of work; `Ok(true)` once the index can be finished.
    pub fn step(&mut self, bases: u64) -> Result<bool, IndexError> {
        let mut done = 0u64;
        while self.phase != Phase::Done && done < bases {
            let Some(&segment) = self.order.get(self.cursor) else {
                self.next_phase()?;
                continue;
            };
            self.cursor += 1;
            let length = self.lengths[segment as usize];
            let start = self.starts[segment as usize];
            self.scan(start, length);
            done += u64::from(length);
            self.done_bases += u64::from(length);
        }
        Ok(self.phase == Phase::Done)
    }

    /// From 0 to 1 over both passes.
    pub fn progress(&self) -> f64 {
        self.done_bases as f64 / (2 * self.bases.bases).max(1) as f64
    }

    fn next_phase(&mut self) -> Result<(), IndexError> {
        self.cursor = 0;
        match self.phase {
            Phase::Count => {
                let mut total = 0u32;
                for bucket in &mut self.buckets {
                    let count = *bucket;
                    *bucket = total;
                    total += count;
                }
                reserve(&mut self.entries, total as usize)?;
                self.entries.resize(total as usize, 0);
                self.phase = Phase::Fill;
            }
            Phase::Fill => {
                // Filling advanced each bucket to where the next one starts.
                self.buckets.rotate_right(1);
                self.buckets[0] = 0;
                self.phase = Phase::Done;
            }
            Phase::Done => {}
        }
        Ok(())
    }

    fn scan(&mut self, start: u32, length: u32) {
        let Self {
            bases,
            k,
            window,
            phase,
            shift,
            buckets,
            entries,
            ..
        } = self;
        let shift = *shift;
        let mut emit = |pos: u32, canonical: u32| {
            let bucket = bucket_of(canonical, shift);
            if *phase == Phase::Fill {
                entries[buckets[bucket] as usize] = pos;
            }
            buckets[bucket] += 1;
        };
        if *window == 1 {
            each_kmer(bases, start, length, *k, &mut emit);
        } else {
            let mut winnower = Winnower::new(*window);
            each_kmer(bases, start, length, *k, |pos, canonical| {
                winnower.push(pos, canonical, &mut emit);
            });
            winnower.end_run(&mut emit);
        }
    }

    pub fn finish(self) -> KmerIndex {
        let mut order_starts = Vec::with_capacity(self.order.len());
        order_starts.extend(self.order.iter().map(|&s| self.starts[s as usize]));
        KmerIndex {
            k: self.k,
            window: self.window,
            shift: self.shift,
            bases: self.bases,
            order: self.order,
            order_starts,
            starts: self.starts,
            lengths: self.lengths,
            buckets: self.buckets,
            entries: self.entries,
        }
    }
}

fn reserve(v: &mut Vec<u32>, n: usize) -> Result<(), IndexError> {
    v.try_reserve_exact(n).map_err(|_| IndexError::OutOfMemory)
}

/// Knuth's multiplicative hashing, TAOCP vol. 3.
const HASH_MULTIPLIER: u32 = 2_654_435_761;

fn bucket_of(canonical: u32, shift: u32) -> usize {
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
fn each_kmer(bases: &Packed, start: u32, length: u32, k: usize, mut visit: impl FnMut(u32, u32)) {
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

/// Robust winnowing (Schleimer et al. 2003): the rightmost smallest hash of each
/// window of `w` k-mers, so an exact match of `k + w - 1` bases always holds one.
/// A run shorter than a window still gives its smallest.
struct Winnower {
    w: u32,
    queue: VecDeque<(u32, u32, u32)>,
    last: Option<u32>,
    previous: Option<u32>,
    seen: u32,
}

impl Winnower {
    fn new(w: u32) -> Self {
        Self {
            w,
            queue: VecDeque::new(),
            last: None,
            previous: None,
            seen: 0,
        }
    }

    fn push(&mut self, pos: u32, canonical: u32, emit: &mut impl FnMut(u32, u32)) {
        if self.previous.is_some_and(|p| p + 1 != pos) {
            self.end_run(emit);
        }
        self.previous = Some(pos);
        let hash = canonical.wrapping_mul(HASH_MULTIPLIER);
        while self.queue.back().is_some_and(|&(h, _, _)| h >= hash) {
            self.queue.pop_back();
        }
        self.queue.push_back((hash, pos, canonical));
        if self
            .queue
            .front()
            .is_some_and(|&(_, p, _)| p + self.w <= pos)
        {
            self.queue.pop_front();
        }
        self.seen += 1;
        if self.seen >= self.w {
            self.emit_front(emit);
        }
    }

    fn end_run(&mut self, emit: &mut impl FnMut(u32, u32)) {
        if self.seen > 0 && self.seen < self.w {
            self.emit_front(emit);
        }
        self.queue.clear();
        self.seen = 0;
    }

    fn emit_front(&mut self, emit: &mut impl FnMut(u32, u32)) {
        if let Some(&(_, pos, canonical)) = self.queue.front()
            && self.last != Some(pos)
        {
            emit(pos, canonical);
            self.last = Some(pos);
        }
    }
}

pub struct KmerIndex {
    k: usize,
    window: u32,
    shift: u32,
    bases: Packed,
    order: Vec<u32>,
    order_starts: Vec<u32>,
    starts: Vec<u32>,
    lengths: Vec<u32>,
    buckets: Vec<u32>,
    entries: Vec<u32>,
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
