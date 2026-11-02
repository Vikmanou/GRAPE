//! The graph's links as the walks between hits read them.

use crate::store::{Links, link_bits};

/// A strand of a segment: `2 × segment + reverse`.
pub(super) fn node(segment: u32, reverse: bool) -> u32 {
    segment * 2 + u32::from(reverse)
}

#[derive(Clone, Copy)]
pub(super) struct Edge {
    pub(super) to: u32,
    /// Bases of `to` the link overlaps.
    pub(super) overlap: u32,
    pub(super) unknown: bool,
}

/// Every link in both of its directions, by the strand it leaves.
pub struct LinkTable {
    offsets: Vec<u32>,
    edges: Vec<Edge>,
}

impl LinkTable {
    /// The arrays of `Links`, with `bits` as in `link_bits`.
    pub fn new(
        segments: usize,
        from: &[u32],
        to: &[u32],
        bits: &[u8],
        overlap_from: &[u32],
        overlap_to: &[u32],
    ) -> Self {
        let n = from
            .len()
            .min(to.len())
            .min(bits.len())
            .min(overlap_from.len())
            .min(overlap_to.len());
        let nodes = segments * 2;
        let ends = |i: usize| {
            let from_reverse = bits[i] & link_bits::FROM_REVERSE != 0;
            let to_reverse = bits[i] & link_bits::TO_REVERSE != 0;
            let a = (from[i], from_reverse);
            let b = (to[i], to_reverse);
            let valid = (from[i] as usize) < segments && (to[i] as usize) < segments;
            (a, b, valid)
        };
        let mut offsets = vec![0u32; nodes + 1];
        for i in 0..n {
            let ((a, ar), (b, br), valid) = ends(i);
            if valid {
                offsets[node(a, ar) as usize + 1] += 1;
                offsets[node(b, !br) as usize + 1] += 1;
            }
        }
        for i in 0..nodes {
            offsets[i + 1] += offsets[i];
        }
        let mut next = offsets.clone();
        let blank = Edge {
            to: 0,
            overlap: 0,
            unknown: false,
        };
        let mut edges = vec![blank; offsets[nodes] as usize];
        for i in 0..n {
            let ((a, ar), (b, br), valid) = ends(i);
            if !valid {
                continue;
            }
            let unknown = bits[i] & link_bits::OVERLAP_UNKNOWN != 0;
            for (leave, to, overlap) in [
                (node(a, ar), node(b, br), overlap_to[i]),
                (node(b, !br), node(a, !ar), overlap_from[i]),
            ] {
                let at = &mut next[leave as usize];
                edges[*at as usize] = Edge {
                    to,
                    overlap,
                    unknown,
                };
                *at += 1;
            }
        }
        Self { offsets, edges }
    }

    pub fn from_links(segments: usize, links: &Links) -> Self {
        Self::new(
            segments,
            &links.from,
            &links.to,
            &links.bits,
            &links.overlap_from,
            &links.overlap_to,
        )
    }

    pub(super) fn out(&self, from: u32) -> &[Edge] {
        let from = from as usize;
        match (self.offsets.get(from), self.offsets.get(from + 1)) {
            (Some(&a), Some(&b)) => &self.edges[a as usize..b as usize],
            _ => &[],
        }
    }

    pub fn heap_bytes(&self) -> usize {
        self.offsets.capacity() * 4 + self.edges.capacity() * std::mem::size_of::<Edge>()
    }
}
