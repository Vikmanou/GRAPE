//! N50 follows Bandage's `getNodeStats` and dead ends its per-end
//! `getDeadEndCount`, and depth quartiles its `determineGraphInfo`
//! (<https://github.com/rrwick/Bandage/blob/main/graph/assemblygraph.cpp>).

use crate::analysis::components::Components;
use crate::store::csr::{Adjacency, end};
use crate::store::{Segments, seg_flags};

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Stats {
    pub segments: u64,
    pub undefined: u64,
    pub links: u64,
    pub total_length: u64,
    pub n50: u32,
    pub n75: u32,
    pub longest: u32,
    pub shortest: u32,
    pub components: u64,
    pub largest_component_length: u64,
    pub largest_component_segments: u64,
    /// Segment ends with no link.
    pub dead_ends: u64,
    pub isolated: u64,
    /// Weighted by length, over segments with a known depth.
    pub mean_depth: f64,
    /// Weighted by length, over segments with sequence.
    pub gc: f64,
    /// Over segments with a known depth; NaN when none has one.
    pub depth_q1: f64,
    pub depth_q3: f64,
    pub depth_min: f64,
    pub depth_max: f64,
    /// Over segments with sequence; NaN when none has one.
    pub gc_min: f64,
    pub gc_max: f64,
}

pub(crate) fn compute(
    segments: &Segments,
    adjacency: &Adjacency,
    components: &Components,
    links: usize,
) -> Stats {
    let mut s = Stats {
        links: links as u64,
        components: components.len() as u64,
        largest_component_length: components.length.first().copied().unwrap_or(0),
        largest_component_segments: components.segments.first().copied().map_or(0, u64::from),
        ..Stats::default()
    };
    let mut lengths = Vec::with_capacity(segments.len());
    let mut depths = Vec::new();
    let (mut gc_min, mut gc_max) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut depth_sum, mut depth_weight) = (0.0f64, 0.0f64);
    let (mut gc_sum, mut gc_weight) = (0.0f64, 0.0f64);
    for i in 0..segments.len() {
        if segments.flags[i] & seg_flags::DEFINED == 0 {
            s.undefined += 1;
            continue;
        }
        let length = segments.length[i];
        lengths.push(length);
        let id = i as u32;
        let dead = u64::from(adjacency.degree(end(id, false)) == 0)
            + u64::from(adjacency.degree(end(id, true)) == 0);
        s.dead_ends += dead;
        s.isolated += u64::from(dead == 2);
        let w = f64::from(length);
        let depth = f64::from(segments.depth[i]);
        if !depth.is_nan() {
            depths.push(depth);
            depth_sum += depth * w;
            depth_weight += w;
        }
        let gc = f64::from(segments.gc[i]);
        if !gc.is_nan() {
            gc_min = gc_min.min(gc);
            gc_max = gc_max.max(gc);
            gc_sum += gc * w;
            gc_weight += w;
        }
    }
    s.segments = lengths.len() as u64;
    s.mean_depth = if depth_weight > 0.0 {
        depth_sum / depth_weight
    } else {
        f64::NAN
    };
    s.gc = if gc_weight > 0.0 {
        gc_sum / gc_weight
    } else {
        f64::NAN
    };

    (s.gc_min, s.gc_max) = if gc_min <= gc_max {
        (gc_min, gc_max)
    } else {
        (f64::NAN, f64::NAN)
    };
    depths.sort_unstable_by(f64::total_cmp);
    s.depth_q1 = quartile(&depths, 1.0);
    s.depth_q3 = quartile(&depths, 3.0);
    s.depth_min = depths.first().copied().unwrap_or(f64::NAN);
    s.depth_max = depths.last().copied().unwrap_or(f64::NAN);

    lengths.sort_unstable_by(|a, b| b.cmp(a));
    s.total_length = lengths.iter().map(|&l| u64::from(l)).sum();
    s.longest = lengths.first().copied().unwrap_or(0);
    s.shortest = lengths.last().copied().unwrap_or(0);
    s.n50 = nx(&lengths, s.total_length, 1, 2);
    s.n75 = nx(&lengths, s.total_length, 3, 4);
    s
}

/// The length at which the running total, longest first, reaches `num/den`.
fn nx(sorted_desc: &[u32], total: u64, num: u64, den: u64) -> u32 {
    let mut sum = 0u64;
    for &l in sorted_desc {
        sum += u64::from(l);
        if sum * den >= total * num {
            return l;
        }
    }
    0
}

/// Bandage's `getValueUsingFractionalIndex` at `(n - 1) * q / 4`, over a list
/// that holds every depth twice since Bandage keeps both strands of each node.
pub fn quartile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let doubled = |k: usize| sorted[k / 2];
    let last = sorted.len() * 2 - 1;
    let index = last as f64 * q / 4.0;
    let whole = index.floor() as usize;
    if whole >= last {
        return doubled(last);
    }
    let fraction = index - whole as f64;
    doubled(whole) * (1.0 - fraction) + doubled(whole + 1) * fraction
}

#[cfg(test)]
mod tests {
    use super::{nx, quartile};

    #[test]
    fn quartiles_count_each_depth_twice() {
        assert_eq!(quartile(&[1.0, 3.0], 1.0), 1.0);
        assert_eq!(quartile(&[1.0, 3.0], 3.0), 3.0);
        assert_eq!(quartile(&[1.0, 2.0, 3.0], 1.0), 1.25);
        assert_eq!(quartile(&[5.0], 3.0), 5.0);
        assert!(quartile(&[], 1.0).is_nan());
    }

    #[test]
    fn n50_and_n75() {
        let l = [12, 10, 8];
        assert_eq!(nx(&l, 30, 1, 2), 10);
        assert_eq!(nx(&l, 30, 3, 4), 8);
        assert_eq!(nx(&[], 0, 1, 2), 0);
    }
}
