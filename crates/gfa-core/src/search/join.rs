//! Alignments on segments become hits along the graph: two parts join when a
//! link leads from one to the other and the query fits what the walk spells.
//! Short segments hold no k-mer, so walks may pass through segments no seed
//! reached, as in a pangenome's SNP bubbles.

use super::align::{GAP_EXTEND, GAP_OPEN, MATCH, MISMATCH};
use super::kmer::KmerIndex;
use super::seed::Part;
use crate::store::{Links, link_bits};

/// How far apart in the query two parts may be and still join.
const MAX_GAP: i64 = 256;
/// How far the query's gap may differ from what the walk spells.
const SLACK: i64 = 16;
const MAX_BRIDGE_STEPS: usize = 8;
const MAX_WALKS: usize = 256;
const MAX_PREDECESSORS: usize = 512;

/// A strand of a segment: `2 × segment + reverse`.
fn node(segment: u32, reverse: bool) -> u32 {
    segment * 2 + u32::from(reverse)
}

#[derive(Clone, Copy)]
struct Edge {
    to: u32,
    /// Bases of `to` the link overlaps.
    overlap: u32,
    unknown: bool,
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

    fn out(&self, from: u32) -> &[Edge] {
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

/// One or more parts along a walk through the graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub parts: Vec<Part>,
    pub score: i32,
    pub q_start: u32,
    pub q_end: u32,
    pub matches: u32,
    pub columns: u32,
}

/// What joins two parts: the segments between them and what the gap adds.
#[derive(Clone, Default)]
struct Bridge {
    /// Strands walked between the parts and the bases each overlaps at its start.
    between: Vec<(u32, u32)>,
    score: i32,
    matches: u32,
    columns: u32,
    /// Query bases both parts aligned, counted once.
    shared: u32,
}

struct Joiner<'a> {
    index: &'a KmerIndex,
    links: &'a LinkTable,
    query: &'a [u8],
}

impl Joiner<'_> {
    fn tail(&self, part: &Part) -> i64 {
        i64::from(self.index.length(part.segment)) - i64::from(part.t_end)
    }

    /// What the gap between two parts scores, with `walk` the bases it spells.
    fn scored(&self, a: &Part, b: &Part, walk: &[u8], between: Vec<(u32, u32)>) -> Bridge {
        let q_from = a.q_end.min(b.q_start) as usize;
        let shared = a.q_end.saturating_sub(b.q_start);
        let gap = &self.query[q_from..b.q_start as usize];
        let walk = if shared > 0 { &[][..] } else { walk };
        let (score, matches, columns) = global(gap, walk);
        Bridge {
            between,
            score: score - MATCH * shared as i32,
            matches,
            columns,
            shared,
        }
    }

    /// Bases of `a`'s tail, the walk and `b`'s head, less the links' overlaps.
    fn spell(&self, a: &Part, b: &Part, walk: &[(u32, u32)], last_overlap: u32) -> Vec<u8> {
        let mut out = self.index.oriented(a.segment, a.reverse, a.t_end, u32::MAX);
        let mut add = |bases: Vec<u8>, overlap: u32| {
            let overlap = overlap as usize;
            let keep = out.len().saturating_sub(overlap);
            let skip = overlap - (out.len() - keep);
            out.truncate(keep);
            out.extend_from_slice(bases.get(skip..).unwrap_or(&[]));
        };
        for &(n, overlap) in walk {
            add(self.index.oriented(n / 2, n & 1 == 1, 0, u32::MAX), overlap);
        }
        add(
            self.index.oriented(b.segment, b.reverse, 0, b.t_start),
            last_overlap,
        );
        out
    }

    fn join(&self, a: &Part, b: &Part) -> Option<Bridge> {
        let gap = i64::from(b.q_start) - i64::from(a.q_end);
        if b.q_start <= a.q_start || b.q_end <= a.q_end || gap > MAX_GAP {
            return None;
        }
        let target = node(b.segment, b.reverse);
        let leave = node(a.segment, a.reverse);
        let head = i64::from(b.t_start);
        // Some tools write links as 0M over segments that do overlap (the
        // Myxococcus sample: `ks:i:41`, 40 bases shared, every CIGAR 0M). Parts
        // that share query bases at the ends a link joins show the real overlap.
        let shares_ends = gap < 0 && self.tail(a) <= SLACK && head <= SLACK;
        let fits = |spelled: i64, unknown: bool| {
            if unknown || shares_ends {
                gap <= spelled + SLACK
            } else {
                (gap - spelled).abs() <= SLACK && spelled <= MAX_GAP
            }
        };
        let direct = self
            .links
            .out(leave)
            .iter()
            .filter(|e| e.to == target)
            .filter(|e| fits(self.tail(a) + head - i64::from(e.overlap), e.unknown))
            .min_by_key(|e| (gap - (self.tail(a) + head - i64::from(e.overlap))).abs());
        if let Some(edge) = direct {
            let walk = self.spell(a, b, &[], edge.overlap);
            return Some(self.scored(a, b, &walk, Vec::new()));
        }
        let mut search = Walks {
            joiner: self,
            a,
            b,
            target,
            gap,
            walk: Vec::new(),
            walks: 0,
            best: None,
        };
        search.step(leave, self.tail(a));
        search.best
    }
}

/// Walks from one part's strand towards another's, through segments short
/// enough to fit the query's gap.
struct Walks<'a> {
    joiner: &'a Joiner<'a>,
    a: &'a Part,
    b: &'a Part,
    target: u32,
    gap: i64,
    walk: Vec<(u32, u32)>,
    walks: usize,
    best: Option<Bridge>,
}

impl Walks<'_> {
    fn step(&mut self, from: u32, spelled: i64) {
        let joiner = self.joiner;
        for edge in joiner.links.out(from) {
            if self.walks >= MAX_WALKS {
                return;
            }
            self.walks += 1;
            let at = spelled - i64::from(edge.overlap);
            if edge.to == self.target && !self.walk.is_empty() {
                let total = at + i64::from(self.b.t_start);
                if (self.gap - total).abs() <= SLACK {
                    let bases = joiner.spell(self.a, self.b, &self.walk, edge.overlap);
                    let bridge = joiner.scored(self.a, self.b, &bases, self.walk.clone());
                    if self.best.as_ref().is_none_or(|b| bridge.score > b.score) {
                        self.best = Some(bridge);
                    }
                }
                continue;
            }
            let length = joiner.index.length(edge.to / 2);
            let next = at + i64::from(length);
            if length == 0 || next > self.gap + SLACK || self.walk.len() >= MAX_BRIDGE_STEPS {
                continue;
            }
            self.walk.push((edge.to, edge.overlap));
            self.step(edge.to, next);
            self.walk.pop();
        }
    }
}

/// Global alignment with the search's scores, for the few bases of a gap:
/// `(score, matches, columns)`.
fn global(query: &[u8], walk: &[u8]) -> (i32, u32, u32) {
    #[derive(Clone, Copy)]
    struct Cell(i32, u32, u32);
    let open = |n: usize| {
        if n == 0 {
            0
        } else {
            -GAP_OPEN - GAP_EXTEND * n as i32
        }
    };
    let width = walk.len() + 1;
    let mut up: Vec<Cell> = (0..width).map(|j| Cell(open(j), 0, j as u32)).collect();
    let mut gaps = vec![i32::MIN / 2; width];
    for (i, &a) in query.iter().enumerate() {
        let mut row = Vec::with_capacity(width);
        row.push(Cell(open(i + 1), 0, i as u32 + 1));
        let mut e = i32::MIN / 2;
        for (j, &b) in walk.iter().enumerate() {
            let same = a == b && matches!(a, b'A' | b'C' | b'G' | b'T');
            let d = up[j];
            let left = row[j];
            let above = up[j + 1];
            e = (left.0 - GAP_OPEN - GAP_EXTEND).max(e - GAP_EXTEND);
            gaps[j + 1] = (above.0 - GAP_OPEN - GAP_EXTEND).max(gaps[j + 1] - GAP_EXTEND);
            let diagonal = d.0 + if same { MATCH } else { MISMATCH };
            row.push(if diagonal >= e && diagonal >= gaps[j + 1] {
                Cell(diagonal, d.1 + u32::from(same), d.2 + 1)
            } else if e >= gaps[j + 1] {
                Cell(e, left.1, left.2 + 1)
            } else {
                Cell(gaps[j + 1], above.1, above.2 + 1)
            });
        }
        up = row;
    }
    let last = up[walk.len()];
    (last.0, last.1, last.2)
}

/// Parts chained into hits: each part in exactly one hit, the best chains first.
pub fn join(index: &KmerIndex, links: &LinkTable, query: &[u8], mut parts: Vec<Part>) -> Vec<Hit> {
    parts.sort_unstable_by_key(|p| (p.q_start, p.q_end, p.segment, p.reverse));
    let joiner = Joiner {
        index,
        links,
        query,
    };
    let mut best: Vec<i64> = Vec::with_capacity(parts.len());
    let mut from: Vec<Option<(usize, Bridge)>> = Vec::with_capacity(parts.len());
    for (i, part) in parts.iter().enumerate() {
        let mut top = i64::from(part.score);
        let mut link = None;
        for j in (i.saturating_sub(MAX_PREDECESSORS)..i).rev() {
            if let Some(bridge) = joiner.join(&parts[j], part) {
                let total = best[j] + i64::from(bridge.score) + i64::from(part.score);
                if link.is_none() || total > top {
                    top = total;
                    link = Some((j, bridge));
                }
            }
        }
        best.push(top);
        from.push(link);
    }
    let mut order: Vec<usize> = (0..parts.len()).collect();
    order.sort_by_key(|&i| (std::cmp::Reverse(best[i]), i));
    let mut used = vec![false; parts.len()];
    let mut hits = Vec::new();
    for end in order {
        if !used[end] {
            hits.push(chain(index, &parts, &from, &mut used, end));
        }
    }
    hits.sort_by_key(|h| (std::cmp::Reverse(h.score), h.q_start));
    hits
}

fn chain(
    index: &KmerIndex,
    parts: &[Part],
    from: &[Option<(usize, Bridge)>],
    used: &mut [bool],
    end: usize,
) -> Hit {
    let last = parts[end];
    let mut hit = Hit {
        parts: vec![last],
        score: last.score,
        q_start: last.q_start,
        q_end: last.q_end,
        matches: last.matches,
        columns: last.columns,
    };
    used[end] = true;
    let mut at = end;
    while let Some((previous, bridge)) = &from[at] {
        if used[*previous] {
            break;
        }
        let part = parts[*previous];
        for &(n, overlap) in bridge.between.iter().rev() {
            let segment = n / 2;
            hit.parts.push(Part {
                segment,
                reverse: n & 1 == 1,
                q_start: part.q_end,
                q_end: parts[at].q_start,
                t_start: overlap.min(index.length(segment)),
                t_end: index.length(segment),
                score: 0,
                matches: 0,
                columns: 0,
            });
        }
        hit.parts.push(part);
        used[*previous] = true;
        hit.score += part.score + bridge.score;
        hit.q_start = part.q_start;
        hit.matches += part.matches + bridge.matches;
        hit.columns += part.columns + bridge.columns;
        hit.matches = hit.matches.saturating_sub(bridge.shared);
        hit.columns = hit.columns.saturating_sub(bridge.shared);
        at = *previous;
    }
    hit.parts.reverse();
    hit
}
