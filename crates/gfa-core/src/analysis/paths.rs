//! What the paths panel shows about P and W records.

use crate::store::csr::{end, link_ends};
use crate::store::graph::Graph;
use crate::store::paths::REVERSE;

/// The end a step leaves its segment by, and the end it enters it by.
fn step_ends(step: u32) -> (u32, u32) {
    let segment = step & !REVERSE;
    let reverse = step & REVERSE != 0;
    (end(segment, !reverse), end(segment, reverse))
}

/// Bases the link from `a`'s leaving end to `b`'s entering end overlaps on
/// `b`; 0 when no such link exists.
pub fn overlap_into(g: &Graph, a: u32, b: u32) -> u32 {
    let (leave, _) = step_ends(a);
    let (_, enter) = step_ends(b);
    let adjacency = &g.adjacency;
    let range =
        adjacency.offsets[leave as usize] as usize..adjacency.offsets[leave as usize + 1] as usize;
    for k in range {
        if adjacency.targets[k] != enter {
            continue;
        }
        let link = adjacency.links[k] as usize;
        let (from_end, _) = link_ends(&g.links, link);
        return if from_end == leave {
            g.links.overlap_to[link]
        } else {
            g.links.overlap_from[link]
        };
    }
    0
}

/// Segment lengths along the path, less the overlaps between its steps.
pub fn path_length(g: &Graph, path: usize) -> u64 {
    let steps = g.paths.steps(path);
    let lengths = &g.segments.length;
    let mut total = 0u64;
    for (k, &step) in steps.iter().enumerate() {
        let length = u64::from(lengths[(step & !REVERSE) as usize]);
        let overlap = if k == 0 {
            0
        } else {
            u64::from(overlap_into(g, steps[k - 1], step))
        };
        total += length.saturating_sub(overlap);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    #[test]
    fn length_removes_the_overlaps_between_steps() {
        let gfa = b"S\ta\tACGTA\nS\tb\tTACC\nS\tc\tGG\nL\ta\t+\tb\t+\t2M\nL\tb\t-\tc\t+\t1M\nP\tp\ta+,b+\t*\nP\tq\tc-,b+\t*\nP\tr\tb-,a-\t*\nP\ts\ta+,c+\t*\n";
        let g = parse(gfa, ParseOptions::default()).unwrap();
        assert_eq!(path_length(&g, 0), 5 + 4 - 2);
        // Mirrors of `b- c+` and of `a+ b+`.
        assert_eq!(path_length(&g, 1), 2 + 4 - 1);
        assert_eq!(path_length(&g, 2), 4 + 5 - 2);
        // No link joins a+ to c+.
        assert_eq!(path_length(&g, 3), 7);
    }
}
