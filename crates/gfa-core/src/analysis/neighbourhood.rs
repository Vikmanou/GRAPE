//! Steps from a set of segments, for showing only what lies near them.
//! As Bandage's `labelNeighbouringNodesAsDrawn` (graph/debruijnnode.cpp), a
//! step follows any link at either end, whatever its orientation.

use crate::analysis::query::set_bits;
use crate::store::graph::Graph;

/// Distances at or past this are not searched.
pub const UNREACHED: u8 = u8::MAX;

/// Steps from the nearest segment whose bit is set, `UNREACHED` beyond 254.
pub fn distances(g: &Graph, from: &[u32]) -> Vec<u8> {
    let n = g.segments.len();
    let mut distance = vec![UNREACHED; n];
    let mut frontier: Vec<u32> = set_bits(from).filter(|&s| (s as usize) < n).collect();
    for &s in &frontier {
        distance[s as usize] = 0;
    }
    let adjacency = &g.adjacency;
    let mut next = Vec::new();
    for step in 1..UNREACHED {
        for &s in &frontier {
            for end in [2 * s, 2 * s + 1] {
                for &target in adjacency.neighbours(end) {
                    let other = (target / 2) as usize;
                    if distance[other] == UNREACHED {
                        distance[other] = step;
                        next.push(other as u32);
                    }
                }
            }
        }
        if next.is_empty() {
            break;
        }
        std::mem::swap(&mut frontier, &mut next);
        next.clear();
    }
    distance
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    #[test]
    fn steps_follow_links_both_ways() {
        // a+ b+, c- b- (so b+ c+), d alone.
        let gfa = b"S\ta\tA\nS\tb\tA\nS\tc\tA\nS\td\tA\nL\ta\t+\tb\t+\t0M\nL\tc\t-\tb\t-\t0M\n";
        let g = parse(gfa, ParseOptions::default()).unwrap();
        let id = |name: &[u8]| g.names.find(name).unwrap();
        let from = [1u32 << id(b"c")];
        let d = distances(&g, &from);
        assert_eq!(d[id(b"c") as usize], 0);
        assert_eq!(d[id(b"b") as usize], 1);
        assert_eq!(d[id(b"a") as usize], 2);
        assert_eq!(d[id(b"d") as usize], UNREACHED);
        assert!(distances(&g, &[]).iter().all(|&x| x == UNREACHED));
    }
}
