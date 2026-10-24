//! Multilevel coarsening by heavy-edge matching (Walshaw, "A Multilevel
//! Algorithm for Force-Directed Graph Drawing", 2000): each level merges
//! pairs of joined nodes, so a coarse layout settles the global shape
//! cheaply and finer levels only refine it.

use super::points::Springs;
use super::rng::Rng;

pub(crate) const NONE: u32 = u32::MAX;

#[derive(Debug, Default, Clone)]
pub(crate) struct Level {
    /// Level 0 points each node stands for.
    pub mass: Vec<f32>,
    /// Estimated extent of the points a node stands for.
    pub span: Vec<f32>,
    pub component: Vec<u32>,
    pub component_start: Vec<u32>,
    pub springs: Springs,
}

/// How a coarse node splits back into the finer level.
#[derive(Debug, Default, Clone)]
pub(crate) struct Split {
    /// Coarse node of each finer node.
    pub parent: Vec<u32>,
    /// Per coarse node: its two finer nodes (the second may be `NONE`) and
    /// the rest length that joined them.
    pub children: Vec<(u32, u32, f32)>,
}

impl Level {
    pub fn len(&self) -> usize {
        self.mass.len()
    }

    /// Merges matched pairs; nodes of `frozen` components are kept as they
    /// are. Returns `None` once a level no longer shrinks enough to pay off.
    pub fn coarsen(&self, frozen: &[bool], rng: &mut Rng) -> Option<(Level, Split)> {
        let n = self.len();
        let (offsets, edges) = self.adjacency();
        let mut order: Vec<u32> = (0..n as u32).collect();
        for i in (1..n).rev() {
            let j = (rng.next_u64() % (i as u64 + 1)) as usize;
            order.swap(i, j);
        }

        let mut partner = vec![NONE; n];
        let mut joined_by = vec![0.0f32; n];
        for &u in &order {
            let u = u as usize;
            if partner[u] != NONE || frozen[self.component[u] as usize] {
                continue;
            }
            // Heaviest edge for the lightest pair, so masses stay balanced.
            let mut best = (NONE, f32::MIN, 0.0);
            for &e in &edges[offsets[u] as usize..offsets[u + 1] as usize] {
                let s = &self.springs;
                let v = if s.a[e as usize] as usize == u {
                    s.b[e as usize]
                } else {
                    s.a[e as usize]
                };
                if v as usize == u || partner[v as usize] != NONE {
                    continue;
                }
                let score = s.weight[e as usize] / (self.mass[u] + self.mass[v as usize]);
                if score > best.1 || (score == best.1 && v < best.0) {
                    best = (v, score, s.rest[e as usize]);
                }
            }
            if best.0 != NONE {
                partner[u] = best.0;
                partner[best.0 as usize] = u as u32;
                joined_by[u] = best.2;
            }
        }

        let active = (0..n)
            .filter(|&u| !frozen[self.component[u] as usize])
            .count();
        let merged = partner.iter().filter(|&&p| p != NONE).count() / 2;
        if active == 0 || (merged as f32) < active as f32 * 0.1 {
            return None;
        }

        let mut split = Split {
            parent: vec![NONE; n],
            children: Vec::with_capacity(n - merged),
        };
        let mut coarse = Level::default();
        for u in 0..n {
            if split.parent[u] != NONE {
                continue;
            }
            let id = split.children.len() as u32;
            split.parent[u] = id;
            let v = partner[u];
            let (mass, span, rest) = if v == NONE {
                (self.mass[u], self.span[u], 0.0)
            } else {
                split.parent[v as usize] = id;
                let rest = joined_by[u].max(joined_by[v as usize]);
                (
                    self.mass[u] + self.mass[v as usize],
                    self.span[u].hypot(self.span[v as usize]) + rest,
                    rest,
                )
            };
            split.children.push((u as u32, v, rest));
            coarse.mass.push(mass);
            coarse.span.push(span);
            coarse.component.push(self.component[u]);
        }
        coarse.component_start = starts(&coarse.component, self.component_start.len() - 1);
        coarse.springs = self.coarse_springs(&split.parent, &coarse.span);
        Some((coarse, split))
    }

    /// Springs between merged nodes, combined. The rest length grows by how
    /// much each end's node outgrew the finer node it came from, which is
    /// exact when a chain is merged pairwise.
    fn coarse_springs(&self, parent: &[u32], span: &[f32]) -> Springs {
        let s = &self.springs;
        let mut joined: Vec<(u64, f32, f32)> = Vec::with_capacity(s.len());
        for e in 0..s.len() {
            let (a, b) = (s.a[e] as usize, s.b[e] as usize);
            let (p, q) = (parent[a], parent[b]);
            if p == q {
                continue;
            }
            let grow = (span[p as usize] - self.span[a] + span[q as usize] - self.span[b]) * 0.5;
            let key = u64::from(p.min(q)) << 32 | u64::from(p.max(q));
            joined.push((key, (s.rest[e] + grow) * s.weight[e], s.weight[e]));
        }
        joined.sort_unstable_by_key(|j| j.0);
        let mut springs = Springs::default();
        let mut i = 0;
        while i < joined.len() {
            let key = joined[i].0;
            let (mut rest, mut weight) = (0.0, 0.0);
            while i < joined.len() && joined[i].0 == key {
                rest += joined[i].1;
                weight += joined[i].2;
                i += 1;
            }
            springs.push((key >> 32) as u32, key as u32, rest / weight, weight);
        }
        springs
    }

    /// Spring ids per node, CSR style.
    fn adjacency(&self) -> (Vec<u32>, Vec<u32>) {
        let s = &self.springs;
        let mut offsets = vec![0u32; self.len() + 1];
        for e in 0..s.len() {
            offsets[s.a[e] as usize + 1] += 1;
            offsets[s.b[e] as usize + 1] += 1;
        }
        for i in 0..self.len() {
            offsets[i + 1] += offsets[i];
        }
        let mut fill = offsets.clone();
        let mut edges = vec![0u32; offsets[self.len()] as usize];
        for e in 0..s.len() {
            for end in [s.a[e], s.b[e]] {
                edges[fill[end as usize] as usize] = e as u32;
                fill[end as usize] += 1;
            }
        }
        (offsets, edges)
    }
}

/// `starts[c]..starts[c + 1]` are component `c`'s nodes, given nodes sorted
/// by component.
pub(crate) fn starts(component: &[u32], components: usize) -> Vec<u32> {
    let mut starts = vec![0u32; components + 1];
    for &c in component {
        starts[c as usize + 1] += 1;
    }
    for c in 0..components {
        starts[c + 1] += starts[c];
    }
    starts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(n: u32) -> Level {
        let mut springs = Springs::default();
        for i in 0..n - 1 {
            springs.push(i, i + 1, 10.0, 1.0);
        }
        Level {
            mass: vec![1.0; n as usize],
            span: vec![0.0; n as usize],
            component: vec![0; n as usize],
            component_start: vec![0, n],
            springs,
        }
    }

    #[test]
    fn merging_a_chain_keeps_its_length() {
        let fine = chain(64);
        let mut rng = Rng::new(3);
        let (coarse, split) = fine.coarsen(&[false], &mut rng).unwrap();
        assert!(coarse.len() <= 48);
        assert_eq!(coarse.mass.iter().sum::<f32>(), 64.0);
        assert!(split.parent.iter().all(|&p| (p as usize) < coarse.len()));
        // Walking the coarse chain covers the fine chain's 630 units.
        let end_to_end: f32 = coarse.springs.rest.iter().sum::<f32>()
            + (coarse.span[0] + coarse.span[coarse.len() - 1]) * 0.5;
        assert!((end_to_end - 630.0).abs() < 1e-3, "{end_to_end}");
    }

    #[test]
    fn frozen_components_are_left_alone() {
        let fine = chain(8);
        assert!(fine.coarsen(&[true], &mut Rng::new(1)).is_none());
    }
}
