mod common;

use common::load;
use gfa_core::layout::{Layout, LayoutOptions, Topology, TopologyError, link_points, measure};

const TESTDATA: [&str; 14] = [
    "linear.gfa",
    "circle.gfa",
    "bubble.gfa",
    "tip.gfa",
    "tangle.gfa",
    "two_components.gfa",
    "self_loop.gfa",
    "palindrome.gfa",
    "star_ln.gfa",
    "mirror_links.gfa",
    "forward_refs.gfa",
    "paths.gfa",
    "bubble.fastg",
    "circle.fastg",
];

fn run(name: &str, options: LayoutOptions) -> (Layout, Vec<f32>) {
    let graph = load(name);
    let mut layout = Layout::new(graph.topology(), options).unwrap();
    while !layout.step(64) {}
    let mut positions = Vec::new();
    layout.write_positions(&mut positions);
    (layout, positions)
}

fn point(p: &[f32], i: u32) -> (f32, f32) {
    (p[i as usize * 2], p[i as usize * 2 + 1])
}

fn distance(p: &[f32], a: u32, b: u32) -> f32 {
    let ((ax, ay), (bx, by)) = (point(p, a), point(p, b));
    (ax - bx).hypot(ay - by)
}

#[test]
fn every_test_graph_lays_out_finite() {
    for name in TESTDATA {
        let (layout, p) = run(name, LayoutOptions::default());
        assert_eq!(p.len(), layout.points() * 2, "{name}");
        assert!(p.iter().all(|v| v.is_finite()), "{name}");
        assert_eq!(layout.iteration(), layout.total_iterations(), "{name}");
    }
}

#[test]
fn same_seed_same_bits_whatever_the_batching() {
    let options = LayoutOptions::default();
    let graph = load("tangle.gfa");
    let (_, a) = run("tangle.gfa", options);
    let mut layout = Layout::new(graph.topology(), options).unwrap();
    while !layout.step(1) {}
    let mut b = Vec::new();
    layout.write_positions(&mut b);
    assert_eq!(
        a.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
        b.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
    );
    let (_, c) = run("tangle.gfa", LayoutOptions { seed: 2, ..options });
    assert_ne!(a, c);
}

#[test]
fn a_linear_chain_comes_out_straight() {
    let (layout, p) = run("linear.gfa", LayoutOptions::default());
    let c = &layout.chains;
    let last = c.start.len() as u32 - 1;
    let path: f32 = (0..layout.points() as u32 - 1)
        .map(|i| distance(&p, i, i + 1))
        .sum();
    let span = distance(&p, c.first(0), c.last(last));
    assert!(span > path * 0.6, "end to end {span} of {path}");
}

#[test]
fn a_circle_closes_into_a_ring() {
    let (layout, p) = run("circle.gfa", LayoutOptions::default());
    let n = layout.points();
    let (cx, cy) = (0..n as u32).fold((0.0, 0.0), |(x, y), i| {
        let (px, py) = point(&p, i);
        (x + px / n as f32, y + py / n as f32)
    });
    let radii: Vec<f32> = (0..n as u32)
        .map(|i| {
            let (x, y) = point(&p, i);
            (x - cx).hypot(y - cy)
        })
        .collect();
    let (lo, hi) = radii
        .iter()
        .fold((f32::MAX, 0.0f32), |(lo, hi), &r| (lo.min(r), hi.max(r)));
    assert!(lo > hi * 0.3, "radii {lo} to {hi}");
}

#[test]
fn links_pull_segment_ends_together() {
    let graph = load("tangle.gfa");
    let (layout, p) = run("tangle.gfa", LayoutOptions::default());
    let t = graph.topology();
    for i in 0..t.link_from.len() {
        let (a, b) = link_points(&t, &layout.chains, i);
        assert!(distance(&p, a, b) < 100.0, "link {i}");
    }
    let q = measure(&layout, &p);
    assert_eq!(q.overlaps, 0);
    assert!(q.edge_cv < 1.0, "{q:?}");
}

#[test]
fn components_are_packed_apart() {
    let (layout, p) = run("two_components.gfa", LayoutOptions::default());
    let starts = &layout.chains.component_start;
    let bounds: Vec<(f32, f32, f32, f32)> = starts
        .windows(2)
        .map(|w| {
            (w[0]..w[1]).fold(
                (f32::MAX, f32::MAX, f32::MIN, f32::MIN),
                |(x0, y0, x1, y1), i| {
                    let (x, y) = point(&p, i);
                    (x0.min(x), y0.min(y), x1.max(x), y1.max(y))
                },
            )
        })
        .collect();
    assert_eq!(bounds.len(), 2);
    let (a, b) = (bounds[0], bounds[1]);
    let apart = a.2 < b.0 || b.2 < a.0 || a.3 < b.1 || b.3 < a.1;
    assert!(apart, "{a:?} {b:?}");
}

#[test]
fn a_lone_segment_with_a_self_link_bends_into_a_loop() {
    // `L 1 + 1 + 0M` joins the segment's right end to its left end.
    let (layout, p) = run("self_loop.gfa", LayoutOptions::default());
    let c = &layout.chains;
    let length = distance(&p, c.first(0), c.first(0) + 1) * f32::from(c.pieces[0]);
    assert!(c.pieces[0] > 2);
    assert!(distance(&p, c.first(0), c.last(0)) < length * 0.25);
}

#[test]
fn bad_topology_is_an_error_not_a_panic() {
    let lengths = [10, 20];
    let ok = Topology {
        lengths: &lengths,
        components: &[0, 0],
        link_from: &[0],
        link_to: &[1],
        link_bits: &[0],
    };
    assert!(Layout::new(ok, LayoutOptions::default()).is_ok());
    let cases = [
        (
            Topology {
                link_to: &[5],
                ..ok
            },
            TopologyError::BadSegment,
        ),
        (
            Topology {
                components: &[0],
                ..ok
            },
            TopologyError::LengthMismatch,
        ),
        (
            Topology {
                components: &[0, 2],
                ..ok
            },
            TopologyError::BadComponent,
        ),
    ];
    for (t, error) in cases {
        assert_eq!(Layout::new(t, LayoutOptions::default()).err(), Some(error));
    }
    let empty = Topology {
        lengths: &[],
        components: &[],
        link_from: &[],
        link_to: &[],
        link_bits: &[],
    };
    let mut layout = Layout::new(empty, LayoutOptions::default()).unwrap();
    assert!(layout.step(10));
}

fn hierarchy(name: &str, seed: u64) -> gfa_core::layout::Hierarchy {
    let graph = load(name);
    let options = LayoutOptions {
        seed,
        ..LayoutOptions::default()
    };
    Layout::new(graph.topology(), options)
        .unwrap()
        .into_hierarchy()
}

#[test]
fn hierarchy_edges_mirror_each_other() {
    for name in TESTDATA {
        let h = hierarchy(name, 1);
        for level in &h.levels {
            let n = level.len() as u32;
            let mut ends = std::collections::HashMap::new();
            for v in 0..n {
                let node = &level.nodes[v as usize * 4..v as usize * 4 + 4];
                assert!(f32::from_bits(node[1]) > 0.0, "{name}");
                for e in node[2]..node[3] {
                    let edge = &level.edges[e as usize * 3..e as usize * 3 + 3];
                    assert!(edge[0] < n && edge[0] != v, "{name}");
                    let key = (v.min(edge[0]), v.max(edge[0]), edge[1], edge[2]);
                    *ends.entry(key).or_insert(0) += 1;
                }
            }
            assert!(ends.values().all(|&count| count % 2 == 0), "{name}");
            assert_eq!(
                level.nodes.last().map(|&end| end as usize * 3),
                Some(level.edges.len())
            );
        }
    }
}

#[test]
fn hierarchy_children_and_parents_agree() {
    for name in TESTDATA {
        let h = hierarchy(name, 1);
        for l in 1..h.levels.len() {
            let (finer, coarse) = (&h.levels[l - 1], &h.levels[l]);
            assert_eq!(finer.parent.len(), finer.len(), "{name}");
            let mut seen = vec![false; finer.len()];
            for (p, child) in coarse.children.as_chunks::<3>().0.iter().enumerate() {
                for &c in &child[..2] {
                    if c == u32::MAX {
                        continue;
                    }
                    assert_eq!(finer.parent[c as usize], p as u32, "{name}");
                    assert!(!std::mem::replace(&mut seen[c as usize], true), "{name}");
                }
                assert_eq!(
                    f32::from_bits(child[2]) == 0.0,
                    child[1] == u32::MAX,
                    "{name}"
                );
            }
            assert!(seen.iter().all(|&s| s), "{name}");
        }
        let top = h.levels.last().unwrap();
        assert!(top.parent.is_empty() && h.levels[0].children.is_empty());
        assert_eq!(h.start.len(), top.len() * 2, "{name}");
        assert!(h.start.iter().all(|v| v.is_finite()), "{name}");
        for level in &h.levels {
            for (c, &frozen) in h.frozen.iter().enumerate() {
                assert_eq!(level.heat[c] == 0.0, frozen, "{name}");
            }
        }
    }
}

#[test]
fn hierarchy_follows_the_seed() {
    assert_eq!(hierarchy("tangle.gfa", 3), hierarchy("tangle.gfa", 3));
    assert_ne!(
        hierarchy("tangle.gfa", 3).start,
        hierarchy("tangle.gfa", 4).start
    );
}
