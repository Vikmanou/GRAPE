use gfa_core::layout::{CellLists, Grid};
use proptest::prelude::*;

fn found(grid: &Grid, lists: &CellLists, b: [f32; 4]) -> Vec<u32> {
    let (c0, r0, c1, r1) = grid.cells(&b);
    let mut out = lists.wide.clone();
    for r in r0..=r1 {
        for c in c0..=c1 {
            let cell = (r * grid.columns + c) as usize;
            out.extend(&lists.items[lists.starts[cell] as usize..lists.starts[cell + 1] as usize]);
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

fn piece_box(p: &[f32], first: u32) -> [f32; 4] {
    let (i, j) = (first as usize * 2, first as usize * 2 + 2);
    [
        p[i].min(p[j]),
        p[i + 1].min(p[j + 1]),
        p[i].max(p[j]),
        p[i + 1].max(p[j + 1]),
    ]
}

proptest! {
    #[test]
    fn queries_find_every_piece_and_link_whose_box_they_touch(
        points in prop::collection::vec((-500f32..500.0, -500f32..500.0), 2..300),
        query in (-600f32..600.0, -600f32..600.0, 0f32..300.0, 0f32..300.0),
    ) {
        let positions: Vec<f32> = points.iter().flat_map(|&(x, y)| [x, y]).collect();
        let n = points.len() as u32;
        let pieces: Vec<u32> = (0..n - 1).flat_map(|p| [p, p / 3]).collect();
        let links: Vec<u32> = (0..n / 4).flat_map(|l| [l, l + 1, n - 1 - l, n - 2 - l.min(n - 2)]).collect();
        let grid = Grid::build(&positions, &pieces, &links, 2.5);
        let b = [query.0, query.1, query.0 + query.2, query.1 + query.3];

        let pieces_found = found(&grid, &grid.pieces, b);
        for p in 0..n - 1 {
            if overlaps(piece_box(&positions, p), b) {
                prop_assert!(pieces_found.binary_search(&p).is_ok(), "piece {p}");
            }
        }
        let links_found = found(&grid, &grid.links, b);
        for (l, link) in links.as_chunks::<4>().0.iter().enumerate() {
            let (a, z) = (link[0] as usize * 2, link[2] as usize * 2);
            let (ax, ay, zx, zy) = (positions[a], positions[a + 1], positions[z], positions[z + 1]);
            let reach = ((zx - ax).hypot(zy - ay) * 0.4).max(15.0) * 1.5;
            let lb = [ax.min(zx) - reach, ay.min(zy) - reach, ax.max(zx) + reach, ay.max(zy) + reach];
            if overlaps(lb, b) {
                prop_assert!(links_found.binary_search(&(l as u32)).is_ok(), "link {l}");
            }
        }
    }
}

#[test]
fn an_empty_graph_gives_an_empty_grid() {
    let grid = Grid::build(&[], &[], &[], 2.5);
    assert_eq!((grid.columns, grid.rows), (1, 1));
    assert_eq!(grid.pieces.starts, [0, 0]);
    assert!(grid.pieces.items.is_empty() && grid.links.items.is_empty());
}

#[test]
fn a_long_piece_goes_on_the_wide_list() {
    let mut positions = vec![0.0, 0.0, 10_000.0, 0.0];
    let mut pieces = vec![0, 0];
    for i in 0..200u32 {
        positions.extend([i as f32 * 50.0, 10.0, i as f32 * 50.0 + 5.0, 10.0]);
        pieces.extend([2 + i * 2, 1 + i]);
    }
    let grid = Grid::build(&positions, &pieces, &[], 2.5);
    assert_eq!(grid.pieces.wide, [0]);
    assert!(!grid.pieces.items.contains(&0));
}
