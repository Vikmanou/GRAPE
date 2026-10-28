//! The graph with every chain of `chains` merged into one segment, as
//! Bandage's `mergeNodes` builds it (graph/assemblygraph.cpp): the name joins
//! the members' names with `_` and gets `_2`, `_3`… while taken
//! (`getUniqueNodeName`), the depth is the members' mean weighted by length,
//! and links from a chain back into itself go, which leaves a merged circle
//! without its closing link.

use crate::analysis::chains::{self, is_reverse, segment_of, step};
use crate::parse::builder::Builder;
use crate::parse::fields::{Cigar, Overlap};
use crate::parse::warnings::FatalError;
use crate::store::graph::Graph;
use crate::store::{NO_SEQ, link_bits, seg_flags};
use hashbrown::HashSet;

/// A merged graph and, for each of its segments, the steps through the
/// original graph that spell it.
#[derive(Debug)]
pub struct Merged {
    pub graph: Graph,
    /// `step_ends[i - 1]..step_ends[i]` index `steps` and `trims` for segment `i`.
    pub step_ends: Vec<u32>,
    /// Original segments, with `REVERSE` set on reverse steps.
    pub steps: Vec<u32>,
    /// Bases cut from the start of each step's sequence.
    pub trims: Vec<u32>,
    pub chains: usize,
}

impl Merged {
    pub fn steps_of(&self, segment: u32) -> (&[u32], &[u32]) {
        let i = segment as usize;
        let start = if i == 0 {
            0
        } else {
            self.step_ends[i - 1] as usize
        };
        let end = self.step_ends[i] as usize;
        (&self.steps[start..end], &self.trims[start..end])
    }
}

/// Where an original segment went: its new id, and whether it runs backwards there.
#[derive(Clone, Copy)]
struct Place {
    id: u32,
    reverse: bool,
}

fn unique_name(base: Vec<u8>, taken: &HashSet<Vec<u8>>) -> Vec<u8> {
    if !taken.contains(&base) {
        return base;
    }
    (2u64..)
        .map(|k| [&base[..], b"_", k.to_string().as_bytes()].concat())
        .find(|name| !taken.contains(name))
        .unwrap_or(base)
}

pub fn merge(g: &Graph) -> Result<Merged, FatalError> {
    let found = chains::chains(g);
    let n = g.segments.len();
    let mut in_chain = vec![false; n];
    for &s in found.iter().flatten() {
        in_chain[segment_of(s) as usize] = true;
    }
    let mut groups: Vec<Vec<u32>> = (0..n as u32)
        .filter(|&s| g.segments.is_defined(s) && !in_chain[s as usize])
        .map(|s| vec![step(s, false)])
        .collect();
    let singles = groups.len();
    groups.extend(found);

    let mut taken: HashSet<Vec<u8>> = (0..n as u32)
        .filter(|&s| g.segments.is_defined(s))
        .map(|s| g.names.get(s).to_vec())
        .collect();
    let mut b = Builder::bare();
    let mut place: Vec<Option<Place>> = vec![None; n];
    let mut step_ends = Vec::with_capacity(groups.len());
    let mut steps = Vec::new();
    let mut all_trims = Vec::new();
    for (k, group) in groups.iter().enumerate() {
        let name = if k < singles {
            g.names.get(segment_of(group[0])).to_vec()
        } else {
            let parts: Vec<&[u8]> = group.iter().map(|&s| g.names.get(segment_of(s))).collect();
            let name = unique_name(parts.join(&b'_'), &taken);
            for &s in group {
                taken.remove(g.names.get(segment_of(s)));
            }
            taken.insert(name.clone());
            name
        };
        let id = b.define(&name, 0).ok_or(FatalError::TooLarge)?;
        let trims = chains::trims(g, group);
        fill_segment(&mut b, g, id, group, &trims);
        for &s in group {
            place[segment_of(s) as usize] = Some(Place {
                id,
                reverse: is_reverse(s),
            });
        }
        steps.extend_from_slice(group);
        all_trims.extend(trims);
        step_ends.push(steps.len() as u32);
    }
    add_links(&mut b, g, &place, &in_chain);
    add_paths(&mut b, g, &place);
    add_custom(&mut b, g, &place, &in_chain);
    b.version = g.version.clone();
    b.depth_tag = g.depth_tag;
    Ok(Merged {
        graph: Graph::build(b, g.format, g.seq_mode)?,
        step_ends,
        steps,
        trims: all_trims,
        chains: groups.len() - singles,
    })
}

fn fill_segment(b: &mut Builder, g: &Graph, id: u32, group: &[u32], trims: &[u32]) {
    let s = &g.segments;
    let (mut length, mut depth_sum, mut depth_weight) = (0u64, 0.0f64, 0.0f64);
    let (mut gc_sum, mut with_seq) = (0.0f64, true);
    for (&st, &trim) in group.iter().zip(trims) {
        let i = segment_of(st) as usize;
        let kept = u64::from(s.length[i] - trim);
        length += kept;
        let depth = f64::from(s.depth[i]);
        if !depth.is_nan() {
            depth_sum += depth * f64::from(s.length[i]);
            depth_weight += f64::from(s.length[i]);
        }
        gc_sum += f64::from(s.gc[i]) * kept as f64;
        with_seq &= s.flags[i] & seg_flags::HAS_SEQ != 0;
    }
    let i = id as usize;
    let out = &mut b.segments;
    out.length[i] = u32::try_from(length).unwrap_or(u32::MAX);
    out.depth[i] = if depth_weight > 0.0 {
        (depth_sum / depth_weight) as f32
    } else {
        f32::NAN
    };
    out.gc[i] = if length > 0 {
        (gc_sum / length as f64) as f32
    } else {
        f32::NAN
    };
    out.seq[i] = NO_SEQ;
    out.flags[i] = seg_flags::DEFINED | if with_seq { seg_flags::HAS_SEQ } else { 0 };
}

fn add_links(b: &mut Builder, g: &Graph, place: &[Option<Place>], in_chain: &[bool]) {
    let links = &g.links;
    for l in 0..links.len() {
        let (from, to) = (links.from[l], links.to[l]);
        let (Some(f), Some(t)) = (place[from as usize], place[to as usize]) else {
            continue;
        };
        if f.id == t.id && in_chain[from as usize] {
            continue;
        }
        let bits = links.bits[l];
        let overlap = if bits & link_bits::OVERLAP_UNKNOWN != 0 {
            Overlap::Unknown
        } else {
            Overlap::Cigar(Cigar {
                reference: links.overlap_from[l],
                query: links.overlap_to[l],
                simple: bits & link_bits::OVERLAP_COMPLEX == 0,
            })
        };
        b.links.insert(
            (f.id, links.from_reverse(l) != f.reverse),
            (t.id, links.to_reverse(l) != t.reverse),
            overlap,
        );
    }
}

/// Steps through one merged segment collapse into one.
fn add_paths(b: &mut Builder, g: &Graph, place: &[Option<Place>]) {
    let paths = &g.paths;
    for i in 0..paths.len() {
        let mut last = None;
        for &s in paths.steps(i) {
            let Some(p) = place[segment_of(s) as usize] else {
                continue;
            };
            let mapped = step(p.id, is_reverse(s) != p.reverse);
            if last != Some(mapped) {
                b.paths.steps.push(mapped);
                last = Some(mapped);
            }
        }
        let name = paths.names.get(i as u32).to_vec();
        if b.paths.finish_path(&name, paths.kind[i]).is_err() {
            b.paths.discard_pending();
        }
    }
}

/// Bandage gives a merged node no custom colour or label.
fn add_custom(b: &mut Builder, g: &Graph, place: &[Option<Place>], in_chain: &[bool]) {
    let kept = |s: u32| {
        place[s as usize]
            .filter(|_| !in_chain[s as usize])
            .map(|p| p.id)
    };
    let c = &g.custom;
    let out = &mut b.custom;
    out.color = c
        .color
        .iter()
        .filter_map(|&(s, v)| Some((kept(s)?, v)))
        .collect();
    out.color2 = c
        .color2
        .iter()
        .filter_map(|&(s, v)| Some((kept(s)?, v)))
        .collect();
    out.label = c
        .label
        .iter()
        .filter_map(|(s, v)| Some((kept(*s)?, v.clone())))
        .collect();
    out.label2 = c
        .label2
        .iter()
        .filter_map(|(s, v)| Some((kept(*s)?, v.clone())))
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    fn merged(gfa: &[u8]) -> Merged {
        merge(&parse(gfa, ParseOptions::default()).unwrap()).unwrap()
    }

    fn names(m: &Merged) -> Vec<String> {
        let g = &m.graph;
        (0..g.segments.len() as u32)
            .map(|s| String::from_utf8_lossy(g.names.get(s)).into_owned())
            .collect()
    }

    #[test]
    fn names_join_with_underscores_and_stay_unique() {
        // `1_2` already exists, so the chain 1 2 becomes `1_2_2`.
        let m = merged(b"S\t1\tAC\tDP:f:2\nS\t2\tCGT\tDP:f:12\nS\t1_2\tA\nL\t1\t+\t2\t+\t1M\n");
        assert_eq!(names(&m), ["1_2", "1_2_2"]);
        let g = &m.graph;
        assert_eq!(g.segments.length[1], 4);
        // Length-weighted over the members' own lengths, as Bandage's `getMeanDepth`.
        assert!((g.segments.depth[1] - (2.0 * 2.0 + 12.0 * 3.0) / 5.0).abs() < 1e-6);
        assert_eq!(m.steps_of(1), (&[0, 1][..], &[0, 1][..]));
        assert_eq!(m.chains, 1);
    }

    #[test]
    fn links_out_of_a_chain_move_to_its_ends_and_a_circle_loses_its_closing_link() {
        let m = merged(
            b"S\ta\tA\nS\tb\tA\nS\tx\tA\nS\ty\tA\nL\ta\t+\tb\t-\t0M\nL\tx\t+\ta\t+\t0M\nL\ty\t+\ta\t+\t0M\n",
        );
        // x and y both enter a, so the chain is a+ b- and keeps both links at its start.
        assert_eq!(names(&m), ["x", "y", "a_b"]);
        assert_eq!(m.graph.links.len(), 2);
        let circle = merged(b"S\t1\tA\nS\t2\tA\nL\t1\t+\t2\t+\t0M\nL\t2\t+\t1\t+\t0M\n");
        assert_eq!(names(&circle), ["1_2"]);
        assert_eq!(circle.graph.links.len(), 0);
        let self_loop = merged(b"S\t1\tA\nL\t1\t+\t1\t+\t0M\n");
        assert_eq!(self_loop.graph.links.len(), 1);
    }

    #[test]
    fn paths_follow_the_merged_segments() {
        let m = merged(b"S\ta\tA\nS\tb\tA\nS\tc\tA\nS\td\tA\nL\ta\t+\tb\t+\t0M\nL\tb\t+\tc\t+\t0M\nL\tb\t+\td\t+\t0M\nP\tp\td-,b-,a-\t*\n");
        let g = &m.graph;
        let a_b = g.names.find(b"a_b").unwrap();
        let d = g.names.find(b"d").unwrap();
        assert_eq!(g.paths.steps(0), [d | crate::REVERSE, a_b | crate::REVERSE]);
    }
}
