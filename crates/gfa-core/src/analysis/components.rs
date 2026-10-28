use crate::store::csr::{Adjacency, end};
use crate::store::{Links, Segments};

/// Indexed by rank, largest total length first.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Components {
    pub segments: Vec<u32>,
    pub length: Vec<u64>,
    /// Weighted by length over segments with a known depth; NaN when none has one.
    pub mean_depth: Vec<f64>,
    /// The component is a single loop: every segment end has one link, to
    /// another end.
    pub circular: Vec<bool>,
}

impl Components {
    pub fn len(&self) -> usize {
        self.segments.len()
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }
}

fn find(parent: &mut [u32], mut x: u32) -> u32 {
    while parent[x as usize] != x {
        let grand = parent[parent[x as usize] as usize];
        parent[x as usize] = grand;
        x = grand;
    }
    x
}

/// Ties in length go to more segments, then to the lowest segment id, so
/// ranks never depend on hash order.
pub(crate) fn compute(segments: &mut Segments, links: &Links) -> Components {
    let n = segments.len();
    let mut parent: Vec<u32> = (0..n as u32).collect();
    let mut size = vec![1u32; n];
    for i in 0..links.len() {
        let (a, b) = (
            find(&mut parent, links.from[i]),
            find(&mut parent, links.to[i]),
        );
        if a == b {
            continue;
        }
        let (big, small) = if size[a as usize] >= size[b as usize] {
            (a, b)
        } else {
            (b, a)
        };
        parent[small as usize] = big;
        size[big as usize] += size[small as usize];
    }

    // (length, segments, lowest id) per root.
    let mut slot = vec![u32::MAX; n];
    let mut totals: Vec<(u64, u32, u32)> = Vec::new();
    for s in 0..n as u32 {
        let root = find(&mut parent, s) as usize;
        if slot[root] == u32::MAX {
            slot[root] = totals.len() as u32;
            totals.push((0, 0, s));
        }
        let t = &mut totals[slot[root] as usize];
        t.0 += u64::from(segments.length[s as usize]);
        t.1 += 1;
    }

    let mut order: Vec<u32> = (0..totals.len() as u32).collect();
    order.sort_unstable_by_key(|&c| {
        let (length, count, lowest) = totals[c as usize];
        (std::cmp::Reverse(length), std::cmp::Reverse(count), lowest)
    });
    let mut rank = vec![0u32; totals.len()];
    for (r, &c) in order.iter().enumerate() {
        rank[c as usize] = r as u32;
    }
    for s in 0..n {
        let root = find(&mut parent, s as u32) as usize;
        segments.component[s] = rank[slot[root] as usize];
    }
    Components {
        segments: order.iter().map(|&c| totals[c as usize].1).collect(),
        length: order.iter().map(|&c| totals[c as usize].0).collect(),
        mean_depth: Vec::new(),
        circular: Vec::new(),
    }
}

pub(crate) fn describe(components: &mut Components, segments: &Segments, adjacency: &Adjacency) {
    let n = components.len();
    let mut depth_sum = vec![0.0f64; n];
    let mut depth_weight = vec![0.0f64; n];
    let mut circular = vec![true; n];
    for s in 0..segments.len() {
        let c = segments.component[s] as usize;
        let length = f64::from(segments.length[s]);
        let depth = f64::from(segments.depth[s]);
        if !depth.is_nan() {
            depth_sum[c] += depth * length;
            depth_weight[c] += length;
        }
        for right in [false, true] {
            if !one_link_elsewhere(adjacency, end(s as u32, right)) {
                circular[c] = false;
            }
        }
    }
    components.mean_depth = depth_sum
        .iter()
        .zip(&depth_weight)
        .map(|(&sum, &w)| if w > 0.0 { sum / w } else { f64::NAN })
        .collect();
    components.circular = circular;
}

fn one_link_elsewhere(adjacency: &Adjacency, e: u32) -> bool {
    matches!(adjacency.neighbours(e), [other] if *other != e)
}
