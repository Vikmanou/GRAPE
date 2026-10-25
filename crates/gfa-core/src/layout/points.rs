//! Each segment becomes a chain of points so long segments can bend. Drawn
//! lengths follow Bandage's automatic node length (`determineGraphInfo` in
//! `graph/assemblygraph.cpp`, `getDrawnNodeLength` and
//! `getNumberOfOgdfGraphEdges` in `graph/debruijnnode.cpp`, defaults from
//! `program/settings.cpp`, <https://github.com/rrwick/Bandage>).

use super::Topology;
use crate::link_bits;

const MEAN_NODE_LENGTH: f64 = 40.0;
const MIN_TOTAL_GRAPH_LENGTH: f64 = 500.0;
const MIN_NODE_LENGTH: f64 = 5.0;
pub(crate) const NODE_SEGMENT_LENGTH: f32 = 20.0;
pub(crate) const EDGE_LENGTH: f32 = 5.0;

pub fn drawn_per_base(segments: usize, total_length: u64) -> f64 {
    let target = (segments as f64 * MEAN_NODE_LENGTH).max(MIN_TOTAL_GRAPH_LENGTH);
    if total_length == 0 {
        // Bandage's fallback of 10,000 units per megabase.
        1e-2
    } else {
        target / total_length as f64
    }
}

pub fn drawn_length(length: u32, per_base: f64) -> f64 {
    (f64::from(length) * per_base).max(MIN_NODE_LENGTH)
}

/// Pieces of the polyline; a segment has one more point than pieces.
pub fn pieces(drawn: f64, max_pieces: u8) -> u8 {
    let n = (drawn / f64::from(NODE_SEGMENT_LENGTH)).ceil();
    n.clamp(1.0, f64::from(max_pieces.max(1))) as u8
}

/// Points are numbered component by component, so each component is one
/// contiguous range.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Chains {
    pub start: Vec<u32>,
    pub pieces: Vec<u8>,
    pub piece_length: Vec<f32>,
    pub component_start: Vec<u32>,
}

impl Chains {
    pub fn points(&self) -> usize {
        self.component_start.last().map_or(0, |&n| n as usize)
    }

    pub fn first(&self, segment: u32) -> u32 {
        self.start[segment as usize]
    }

    pub fn last(&self, segment: u32) -> u32 {
        self.start[segment as usize] + u32::from(self.pieces[segment as usize])
    }

    /// The neighbour of an end point inside its segment.
    pub fn inner(&self, segment: u32, end: u32) -> u32 {
        if end == self.first(segment) {
            end + 1
        } else {
            end - 1
        }
    }

    /// `(first point, segment)` per polyline piece.
    pub fn pieces(&self) -> Vec<u32> {
        let total: usize = self.pieces.iter().map(|&p| usize::from(p)).sum();
        let mut out = Vec::with_capacity(total * 2);
        for s in 0..self.start.len() as u32 {
            for p in self.first(s)..self.last(s) {
                out.extend([p, s]);
            }
        }
        out
    }

    pub(crate) fn build(t: &Topology, max_pieces: u8) -> Self {
        let n = t.lengths.len();
        let total: u64 = t.lengths.iter().map(|&l| u64::from(l)).sum();
        let per_base = drawn_per_base(n, total);
        let mut pieces_of = Vec::with_capacity(n);
        let mut piece_length = Vec::with_capacity(n);
        for &length in t.lengths {
            let drawn = drawn_length(length, per_base);
            let p = pieces(drawn, max_pieces);
            pieces_of.push(p);
            piece_length.push((drawn / f64::from(p)) as f32);
        }

        let components = t.component_count();
        let mut points_in = vec![0u32; components + 1];
        for s in 0..n {
            points_in[t.components[s] as usize + 1] += u32::from(pieces_of[s]) + 1;
        }
        for c in 0..components {
            points_in[c + 1] += points_in[c];
        }
        let component_start = points_in.clone();
        let mut start = vec![0u32; n];
        for s in 0..n {
            let c = t.components[s] as usize;
            start[s] = points_in[c];
            points_in[c] += u32::from(pieces_of[s]) + 1;
        }
        Self {
            start,
            pieces: pieces_of,
            piece_length,
            component_start,
        }
    }
}

/// Springs along segments first, then one per link.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Springs {
    pub a: Vec<u32>,
    pub b: Vec<u32>,
    pub rest: Vec<f32>,
    /// How many level 0 springs this one stands for.
    pub weight: Vec<f32>,
}

impl Springs {
    pub fn len(&self) -> usize {
        self.a.len()
    }

    pub(crate) fn push(&mut self, a: u32, b: u32, rest: f32, weight: f32) {
        self.a.push(a);
        self.b.push(b);
        self.rest.push(rest);
        self.weight.push(weight);
    }

    pub(crate) fn build(t: &Topology, chains: &Chains) -> Self {
        let mut springs = Self::default();
        for s in 0..t.lengths.len() as u32 {
            let first = chains.first(s);
            for p in first..chains.last(s) {
                springs.push(p, p + 1, chains.piece_length[s as usize], 1.0);
            }
        }
        for i in 0..t.link_from.len() {
            let (a, b) = link_points(t, chains, i);
            // `a+ a-` joins one end to itself: nothing to pull.
            if a != b {
                springs.push(a, b, EDGE_LENGTH, 1.0);
            }
        }
        springs
    }
}

/// The points a link joins: it leaves its From segment at the right end
/// unless reversed, and enters its To segment at the left end unless reversed.
pub fn link_points(t: &Topology, chains: &Chains, i: usize) -> (u32, u32) {
    let bits = t.link_bits[i];
    let (from, to) = (t.link_from[i], t.link_to[i]);
    let a = if bits & link_bits::FROM_REVERSE == 0 {
        chains.last(from)
    } else {
        chains.first(from)
    };
    let b = if bits & link_bits::TO_REVERSE == 0 {
        chains.first(to)
    } else {
        chains.last(to)
    };
    (a, b)
}

/// `[end a, inner a, end b, inner b]` per link.
pub fn link_geometry(t: &Topology, chains: &Chains) -> Vec<u32> {
    let mut out = Vec::with_capacity(t.link_from.len() * 4);
    for i in 0..t.link_from.len() {
        let (a, b) = link_points(t, chains, i);
        out.extend([
            a,
            chains.inner(t.link_from[i], a),
            b,
            chains.inner(t.link_to[i], b),
        ]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawn_lengths_follow_bandage() {
        // 100 segments over 5 Mb: 4,000 units, so 800 per megabase.
        let per_base = drawn_per_base(100, 5_000_000);
        assert!((drawn_length(1_000_000, per_base) - 800.0).abs() < 1e-9);
        assert_eq!(drawn_length(10, per_base), MIN_NODE_LENGTH);
        // Small graphs are stretched to 500 units in total.
        assert!((drawn_length(50, drawn_per_base(2, 100)) - 250.0).abs() < 1e-9);
        assert_eq!(pieces(800.0, 50), 40);
        assert_eq!(pieces(801.0, 50), 41);
        assert_eq!(pieces(5000.0, 50), 50);
        assert_eq!(pieces(5.0, 50), 1);
    }

    #[test]
    fn links_leave_along_their_segments() {
        // a (2 pieces, capped) +, b (1 piece) -: right end meets right end.
        let t = Topology {
            lengths: &[30, 1],
            components: &[0, 0],
            link_from: &[0],
            link_to: &[1],
            link_bits: &[crate::link_bits::TO_REVERSE],
        };
        let chains = Chains::build(&t, 2);
        assert_eq!(chains.pieces, vec![2, 1]);
        assert_eq!(chains.pieces(), vec![0, 0, 1, 0, 3, 1]);
        assert_eq!(link_geometry(&t, &chains), vec![2, 1, 4, 3]);
    }
}
