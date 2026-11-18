//! Pinned, dragged and imported layouts.

mod common;

use common::{FIXTURES, load, point, run};
use gfa_core::layout::{
    Chains, Fixed, FixedError, Layout, LayoutOptions, link_geometry, positions_from_lines,
};

fn settled(name: &str) -> Layout {
    let graph = load(name);
    let mut layout = Layout::new(graph.topology(), LayoutOptions::default()).unwrap();
    while !layout.step(64) {}
    layout
}

fn positions(layout: &Layout) -> Vec<f32> {
    let mut p = Vec::new();
    layout.write_positions(&mut p);
    p
}

fn segment_points(layout: &Layout, segment: u32) -> std::ops::RangeInclusive<u32> {
    layout.chains.first(segment)..=layout.chains.last(segment)
}

#[test]
fn a_dragged_segment_stays_where_it_was_dropped() {
    let mut layout = settled("tangle.gfa");
    let before = positions(&layout);
    assert!(layout.drag(0, 40.0, -25.0));
    assert_eq!(layout.pinned(), 1);
    assert!(layout.refining());
    let dropped = positions(&layout);
    for p in segment_points(&layout, 0) {
        let (x, y) = point(&before, p);
        assert_eq!(point(&dropped, p), (x + 40.0, y - 25.0));
    }
    while !layout.step(16) {}
    assert!(!layout.refining());
    let after = positions(&layout);
    for p in segment_points(&layout, 0) {
        assert_eq!(point(&after, p), point(&dropped, p));
    }
    assert_ne!(after, dropped, "the rest follows the drag");
    assert_eq!(layout.iteration(), layout.total_iterations());
}

#[test]
fn refining_the_selection_moves_only_the_selection() {
    let mut layout = settled("tangle.gfa");
    let before = positions(&layout);
    let selected = [0b10u32];
    assert!(layout.refine(Some(&selected)));
    layout.drag(1, 30.0, 0.0);
    layout.unpin_all();
    assert!(layout.refine(Some(&selected)));
    while !layout.step(16) {}
    let after = positions(&layout);
    let moved: Vec<u32> = (0..layout.chains.start.len() as u32)
        .filter(|&s| segment_points(&layout, s).any(|p| point(&before, p) != point(&after, p)))
        .collect();
    assert_eq!(moved, [1]);
}

#[test]
fn nothing_is_pinned_before_level_zero() {
    let graph = load("tangle.gfa");
    let mut layout = Layout::new(graph.topology(), LayoutOptions::default()).unwrap();
    assert!(!layout.at_level_zero());
    assert!(!layout.drag(0, 1.0, 1.0));
    assert!(!layout.refine(None));
    assert_eq!(layout.pinned(), 0);
}

#[test]
fn dragging_never_repacks_components() {
    let mut layout = settled("two_components.gfa");
    let before = positions(&layout);
    layout.drag(0, 500.0, 500.0);
    while !layout.step(16) {}
    let after = positions(&layout);
    let other = layout.chains.component_start[1]..layout.chains.component_start[2];
    let first = layout.chains.first(0);
    let other: Vec<u32> = if other.contains(&first) {
        (layout.chains.component_start[0]..layout.chains.component_start[1]).collect()
    } else {
        other.collect()
    };
    let centre = |q: &[f32]| {
        let sum = other.iter().fold((0.0, 0.0), |(x, y), &p| {
            let (px, py) = point(q, p);
            (x + px, y + py)
        });
        (sum.0 / other.len() as f32, sum.1 / other.len() as f32)
    };
    let ((bx, by), (ax, ay)) = (centre(&before), centre(&after));
    // A repack would move the other component by hundreds of units.
    assert!((ax - bx).hypot(ay - by) < 20.0, "{bx},{by} -> {ax},{ay}");
}

#[test]
fn given_positions_get_the_geometry_a_layout_draws() {
    for name in FIXTURES {
        let graph = load(name);
        let t = graph.topology();
        let layout = Layout::new(t, LayoutOptions::default()).unwrap();
        let fixed = Fixed::new(&t).unwrap();
        assert_eq!(fixed.chains, layout.chains, "{name}");
        assert_eq!(fixed.pieces, layout.chains.pieces(), "{name}");
        assert_eq!(fixed.links, link_geometry(&t, &layout.chains), "{name}");
    }
}

/// One line per kept segment, its chain's own points.
fn lines_of(
    chains: &Chains,
    positions: &[f32],
    keep: impl Fn(usize) -> bool,
) -> (Vec<f32>, Vec<u32>) {
    let mut lines = Vec::new();
    let mut starts = vec![0u32];
    for s in 0..chains.start.len() {
        if keep(s) {
            let first = chains.start[s] as usize;
            for p in first..=first + usize::from(chains.pieces[s]) {
                lines.extend([positions[2 * p], positions[2 * p + 1]]);
            }
        }
        starts.push((lines.len() / 2) as u32);
    }
    (lines, starts)
}

#[test]
fn lines_with_the_chains_points_are_kept_exactly() {
    let (_, laid) = run("tangle.gfa", LayoutOptions::default());
    let graph = load("tangle.gfa");
    let t = graph.topology();
    let chains = &Fixed::new(&t).unwrap().chains;
    let (lines, starts) = lines_of(chains, &laid, |_| true);
    let (positions, drawn) = positions_from_lines(chains, &lines, &starts).unwrap();
    assert_eq!(positions, laid);
    assert!(drawn.iter().all(|&d| d));
}

#[test]
fn foreign_lines_are_resampled_rescaled_and_missing_segments_left_undrawn() {
    let graph = load("tangle.gfa");
    let t = graph.topology();
    let chains = &Fixed::new(&t).unwrap().chains;
    // Two-point lines along x, ten times longer than the chains: Bandage's own units.
    let mut lines = Vec::new();
    let mut starts = vec![0u32];
    for s in 0..chains.start.len() {
        if s != 1 {
            let length = chains.piece_length[s] * f32::from(chains.pieces[s]) * 10.0;
            lines.extend([s as f32 * 1000.0, 0.0, s as f32 * 1000.0 + length, 0.0]);
        }
        starts.push((lines.len() / 2) as u32);
    }
    let (positions, drawn) = positions_from_lines(chains, &lines, &starts).unwrap();
    assert!(!drawn[1] && drawn[0]);
    for s in (0..chains.start.len()).filter(|&s| s != 1) {
        let first = chains.start[s] as usize;
        let pieces = usize::from(chains.pieces[s]);
        let chain = chains.piece_length[s] * pieces as f32;
        for j in 0..=pieces {
            let want = s as f32 * 100.0 + chain * j as f32 / pieces as f32;
            assert!(
                (positions[2 * (first + j)] - want).abs() < 1e-2 * want.max(1.0),
                "{s} {j}"
            );
            assert_eq!(positions[2 * (first + j) + 1], 0.0);
        }
    }
    assert_eq!(
        positions_from_lines(chains, &lines, &starts[1..]),
        Err(FixedError::Lines)
    );
    let mut bad = lines.clone();
    bad[0] = f32::NAN;
    assert_eq!(
        positions_from_lines(chains, &bad, &starts),
        Err(FixedError::Lines)
    );
}
