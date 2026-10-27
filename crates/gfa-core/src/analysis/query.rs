//! Questions the info panel, find and export ask about loaded segments.

use crate::store::csr::end;
use crate::store::graph::Graph;
use crate::write::fasta::bandage_order;

/// A link at one of a segment's ends, as stored: `from`'s end to `to`'s end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NeighbourLink {
    pub other: u32,
    pub from: u32,
    pub from_reverse: bool,
    pub to: u32,
    pub to_reverse: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SegmentInfo {
    pub length: u32,
    pub depth: f32,
    pub gc: f32,
    pub component: u32,
    /// Links at the segment's start and at its end.
    pub degree: (u32, u32),
    /// Each link once, in adjacency order, at most `limit` of them.
    pub links: Vec<NeighbourLink>,
    pub total_links: usize,
}

pub fn segment_info(g: &Graph, id: u32, limit: usize) -> Option<SegmentInfo> {
    let i = id as usize;
    if i >= g.segments.len() {
        return None;
    }
    let adjacency = &g.adjacency;
    let mut ids: Vec<u32> = [end(id, false), end(id, true)]
        .iter()
        .flat_map(|&e| {
            let e = e as usize;
            adjacency.links[adjacency.offsets[e] as usize..adjacency.offsets[e + 1] as usize].iter()
        })
        .copied()
        .collect();
    // A link joining the segment to itself shows up at both of its ends.
    let mut seen = Vec::with_capacity(ids.len());
    ids.retain(|&link| {
        if seen.contains(&link) {
            return false;
        }
        seen.push(link);
        true
    });
    let links = &g.links;
    let total_links = ids.len();
    let shown = ids.iter().take(limit).map(|&link| {
        let l = link as usize;
        let (from, to) = (links.from[l], links.to[l]);
        NeighbourLink {
            other: if from == id { to } else { from },
            from,
            from_reverse: links.from_reverse(l),
            to,
            to_reverse: links.to_reverse(l),
        }
    });
    Some(SegmentInfo {
        length: g.segments.length[i],
        depth: g.segments.depth[i],
        gc: g.segments.gc[i],
        component: g.segments.component[i],
        degree: (
            adjacency.degree(end(id, false)),
            adjacency.degree(end(id, true)),
        ),
        links: shown.collect(),
        total_links,
    })
}

/// Over the segments whose bit is set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SelectionSummary {
    pub count: u64,
    pub total_length: u64,
    /// Weighted by length over segments with a known depth; NaN when none has one.
    pub mean_depth: f64,
}

pub fn selection_summary(g: &Graph, bits: &[u32]) -> SelectionSummary {
    let (mut count, mut total_length) = (0, 0);
    let (mut depth_sum, mut depth_weight) = (0.0f64, 0.0f64);
    for id in set_bits(bits).filter(|&id| (id as usize) < g.segments.len()) {
        let i = id as usize;
        let length = g.segments.length[i];
        count += 1;
        total_length += u64::from(length);
        let depth = f64::from(g.segments.depth[i]);
        if !depth.is_nan() {
            depth_sum += depth * f64::from(length);
            depth_weight += f64::from(length);
        }
    }
    SelectionSummary {
        count,
        total_length,
        mean_depth: if depth_weight > 0.0 {
            depth_sum / depth_weight
        } else {
            f64::NAN
        },
    }
}

pub fn set_bits(bits: &[u32]) -> impl Iterator<Item = u32> + '_ {
    bits.iter().enumerate().flat_map(|(w, &word)| {
        (0..32)
            .filter(move |b| word >> b & 1 == 1)
            .map(move |b| w as u32 * 32 + b)
    })
}

/// Ids of the names that exist, then the names that do not.
pub fn find_names<'a>(g: &Graph, names: &[&'a [u8]]) -> (Vec<u32>, Vec<&'a [u8]>) {
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for &name in names {
        match g.names.find(name) {
            Some(id) if g.segments.is_defined(id) => found.push(id),
            _ => missing.push(name),
        }
    }
    found.sort_unstable();
    found.dedup();
    (found, missing)
}

/// The segments in the order Bandage exports them.
pub fn export_order(g: &Graph, ids: &[u32]) -> Vec<u32> {
    let mut ids: Vec<u32> = ids
        .iter()
        .copied()
        .filter(|&id| (id as usize) < g.segments.len())
        .collect();
    ids.sort_by(|&a, &b| bandage_order(g.names.get(a), g.names.get(b)));
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    const GFA: &[u8] = b"S\t1\tACGT\tDP:f:2\nS\t2\tAA\nS\t10\tCCCCCC\tDP:f:4\nL\t1\t+\t2\t-\t0M\nL\t2\t+\t2\t-\t0M\nL\t10\t-\t1\t-\t0M\n";

    fn graph() -> Graph {
        parse(GFA, ParseOptions::default()).unwrap()
    }

    #[test]
    fn info_lists_each_link_once() {
        let g = graph();
        let two = g.names.find(b"2").unwrap();
        let info = segment_info(&g, two, 10).unwrap();
        assert_eq!(info.length, 2);
        assert!(info.depth.is_nan());
        // `1+ 2-` and the self link `2+ 2-` both meet 2's end.
        assert_eq!(info.total_links, 2);
        assert_eq!(info.degree, (0, 2));
        assert!(info.links.iter().any(|l| l.other == two));
        assert_eq!(segment_info(&g, two, 1).unwrap().links.len(), 1);
        assert_eq!(segment_info(&g, 99, 10), None);
    }

    #[test]
    fn summary_weights_depth_by_length() {
        let g = graph();
        let mut bits = vec![0u32; 1];
        for name in [&b"1"[..], b"2", b"10"] {
            let id = g.names.find(name).unwrap();
            bits[0] |= 1 << id;
        }
        let s = selection_summary(&g, &bits);
        assert_eq!((s.count, s.total_length), (3, 12));
        assert!((s.mean_depth - (2.0 * 4.0 + 4.0 * 6.0) / 10.0).abs() < 1e-9);
        assert!(selection_summary(&g, &[0]).mean_depth.is_nan());
    }

    #[test]
    fn finds_names_and_lists_the_missing() {
        let g = graph();
        let (found, missing) = find_names(&g, &[b"10", b"x", b"1", b"10"]);
        assert_eq!(found.len(), 2);
        assert_eq!(missing, [&b"x"[..]]);
    }

    #[test]
    fn export_order_is_bandage_order() {
        let g = graph();
        let ids: Vec<u32> = [&b"10"[..], b"2", b"1"]
            .iter()
            .map(|n| g.names.find(n).unwrap())
            .collect();
        let names: Vec<&[u8]> = export_order(&g, &ids)
            .iter()
            .map(|&id| g.names.get(id))
            .collect();
        assert_eq!(names, [&b"1"[..], b"2", b"10"]);
    }
}
