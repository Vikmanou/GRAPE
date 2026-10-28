//! Maximal unbranched chains found as Bandage's "Merge all possible nodes"
//! finds them (`mergeAllPossible` in graph/assemblygraph.cpp,
//! <https://github.com/rrwick/Bandage>): nodes are visited in the order of
//! Bandage's node map, by name with its sign, and each unvisited one grows
//! forward, then backward, through links that are the only one at both ends.

use crate::analysis::paths::overlap_into;
use crate::store::csr::end;
use crate::store::graph::Graph;
use crate::store::paths::REVERSE;
use std::collections::VecDeque;

pub fn step(segment: u32, reverse: bool) -> u32 {
    segment | if reverse { REVERSE } else { 0 }
}

pub fn segment_of(step: u32) -> u32 {
    step & !REVERSE
}

pub fn is_reverse(step: u32) -> bool {
    step & REVERSE != 0
}

fn leaving(s: u32) -> u32 {
    end(segment_of(s), !is_reverse(s))
}

fn entering(s: u32) -> u32 {
    end(segment_of(s), is_reverse(s))
}

/// QMap orders node names as QStrings with their sign; byte order of UTF-8
/// matches it except for characters beyond the Basic Multilingual Plane.
fn bandage_map_order(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    a.iter().chain(b"+").cmp(b.iter().chain(b"+"))
}

/// Chains of two or more oriented segments, in the order Bandage merges them.
pub fn chains(g: &Graph) -> Vec<Vec<u32>> {
    let n = g.segments.len();
    let mut order: Vec<u32> = (0..n as u32)
        .filter(|&s| g.segments.is_defined(s))
        .collect();
    order.sort_by(|&a, &b| bandage_map_order(g.names.get(a), g.names.get(b)));
    let mut unchecked: Vec<bool> = (0..n as u32).map(|s| g.segments.is_defined(s)).collect();
    let adjacency = &g.adjacency;
    let only_link = |e: u32| match adjacency.neighbours(e) {
        [other] if adjacency.degree(*other) == 1 => Some(*other),
        _ => None,
    };
    let mut out = Vec::new();
    for start in order {
        if !unchecked[start as usize] {
            continue;
        }
        unchecked[start as usize] = false;
        let mut chain = VecDeque::from([step(start, false)]);
        while let Some(t) = chain.back().and_then(|&last| only_link(leaving(last))) {
            let next = t / 2;
            if !unchecked[next as usize] {
                break;
            }
            unchecked[next as usize] = false;
            chain.push_back(step(next, t % 2 == 1));
        }
        while let Some(t) = chain.front().and_then(|&first| only_link(entering(first))) {
            let previous = t / 2;
            if !unchecked[previous as usize] {
                break;
            }
            unchecked[previous as usize] = false;
            chain.push_front(step(previous, t % 2 == 0));
        }
        if chain.len() > 1 {
            out.push(chain.into());
        }
    }
    out
}

/// Bases cut from the start of each step's sequence when a chain is spelled:
/// the overlap with the step before, or nothing when the overlap is longer
/// than the step, as Bandage's `modifySequenceUsingOverlap` (graph/path.cpp).
pub fn trims(g: &Graph, steps: &[u32]) -> Vec<u32> {
    let mut out = Vec::with_capacity(steps.len());
    for (k, &s) in steps.iter().enumerate() {
        let overlap = if k == 0 {
            0
        } else {
            overlap_into(g, steps[k - 1], s)
        };
        let length = g.segments.length[segment_of(s) as usize];
        out.push(if overlap <= length { overlap } else { 0 });
    }
    out
}

/// Steps through a chain the other way.
pub fn reversed(steps: &[u32]) -> Vec<u32> {
    steps.iter().rev().map(|&s| s ^ REVERSE).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    fn named(g: &Graph, chain: &[u32]) -> Vec<String> {
        chain
            .iter()
            .map(|&s| {
                let name = String::from_utf8_lossy(g.names.get(segment_of(s))).into_owned();
                format!("{name}{}", if is_reverse(s) { '-' } else { '+' })
            })
            .collect()
    }

    #[test]
    fn chains_grow_from_the_first_name_forward_then_backward() {
        let gfa = b"S\tc\tA\nS\tb\tA\nS\td\tA\nS\ta\tA\nS\te\tA\nL\tb\t-\tc\t+\t0M\nL\tc\t+\td\t+\t0M\nL\ta\t+\te\t+\t0M\n";
        let g = parse(gfa, ParseOptions::default()).unwrap();
        let found = chains(&g);
        assert_eq!(named(&g, &found[0]), ["a+", "e+"]);
        // `b` comes before `c` and `d` in Bandage's order, so its chain reads from b+.
        assert_eq!(named(&g, &found[1]), ["d-", "c-", "b+"]);
    }

    #[test]
    fn a_circle_is_one_chain_and_a_palindrome_stops_it() {
        let circle = parse(
            b"S\t1\tA\nS\t2\tA\nS\t3\tA\nL\t1\t+\t2\t+\t0M\nL\t2\t+\t3\t+\t0M\nL\t3\t+\t1\t+\t0M\n",
            ParseOptions::default(),
        )
        .unwrap();
        assert_eq!(named(&circle, &chains(&circle)[0]), ["1+", "2+", "3+"]);
        let hairpin = parse(
            b"S\ta\tA\nS\tb\tA\nL\ta\t+\tb\t+\t0M\nL\tb\t+\tb\t-\t0M\n",
            ParseOptions::default(),
        )
        .unwrap();
        assert_eq!(named(&hairpin, &chains(&hairpin)[0]), ["a+", "b+"]);
    }

    #[test]
    fn trims_follow_the_overlaps_and_skip_ones_longer_than_the_step() {
        let g = parse(
            b"S\ta\tACGT\nS\tb\tGTA\nS\tc\tAC\nL\ta\t+\tb\t+\t2M\nL\tb\t+\tc\t+\t3M\n",
            ParseOptions::default(),
        )
        .unwrap();
        let chain = &chains(&g)[0];
        assert_eq!(trims(&g, chain), [0, 2, 0]);
        // Backwards, b's 3 bases overlap c's 2 and so all of b goes.
        assert_eq!(trims(&g, &reversed(chain)), [0, 3, 2]);
    }
}
