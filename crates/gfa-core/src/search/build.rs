//! Builds a `KmerIndex` in steps, so a worker can hear a cancel between them.

use super::kmer::{HASH_MULTIPLIER, KmerIndex, MAX_K, MIN_K, bucket_of, each_kmer};
use crate::store::seq::Packed;
use std::collections::VecDeque;

/// Bytes of buckets and entries; larger graphs index minimizers only.
pub const INDEX_BUDGET: u64 = 1 << 30;
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
