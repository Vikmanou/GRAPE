//! The spec's layout quality metrics.

use super::Layout;
use hashbrown::HashMap;

/// Points of different segments closer than this overlap; half of
/// Bandage's default node width of 5.
const OVERLAP: f32 = 2.5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quality {
    /// Coefficient of variation of spring length over rest length.
    pub edge_cv: f64,
    pub link_stretch: f64,
    pub overlaps: u64,
}

pub fn measure(layout: &Layout, positions: &[f32]) -> Quality {
    let springs = &layout.levels[0].springs;
    let first_link = layout.first_link;
    let at = |p: u32| (positions[p as usize * 2], positions[p as usize * 2 + 1]);
    let (mut sum, mut sq, mut stretch) = (0.0f64, 0.0f64, 0.0f64);
    for e in 0..springs.len() {
        let ((ax, ay), (bx, by)) = (at(springs.a[e]), at(springs.b[e]));
        let ratio = f64::from((bx - ax).hypot(by - ay) / springs.rest[e]);
        sum += ratio;
        sq += ratio * ratio;
        if e >= first_link {
            stretch += ratio;
        }
    }
    let n = springs.len().max(1) as f64;
    let mean = sum / n;
    let edge_cv = ((sq / n - mean * mean).max(0.0)).sqrt() / mean.max(f64::MIN_POSITIVE);
    let links = (springs.len() - first_link).max(1) as f64;
    Quality {
        edge_cv,
        link_stretch: stretch / links,
        overlaps: overlaps(layout, positions),
    }
}

/// Each grid cell is checked against itself and the neighbours after it, so
/// every pair is seen once.
fn overlaps(layout: &Layout, positions: &[f32]) -> u64 {
    let c = &layout.chains;
    let points = c.points();
    let mut segment = vec![0u32; points];
    for s in 0..c.start.len() as u32 {
        segment[c.first(s) as usize..=c.last(s) as usize].fill(s);
    }
    let cell = |p: usize| {
        (
            (positions[p * 2] / OVERLAP).floor() as i64,
            (positions[p * 2 + 1] / OVERLAP).floor() as i64,
        )
    };
    let mut grid: HashMap<(i64, i64), Vec<u32>> = HashMap::new();
    for p in 0..points {
        grid.entry(cell(p)).or_default().push(p as u32);
    }
    let mut count = 0;
    for (&(gx, gy), here) in &grid {
        for (dx, dy) in [(0, 0), (1, -1), (1, 0), (1, 1), (0, 1)] {
            let Some(there) = grid.get(&(gx + dx, gy + dy)) else {
                continue;
            };
            for (i, &p) in here.iter().enumerate() {
                let others = if (dx, dy) == (0, 0) {
                    &here[i + 1..]
                } else {
                    there
                };
                for &q in others {
                    if segment[p as usize] == segment[q as usize] {
                        continue;
                    }
                    let (p, q) = (p as usize * 2, q as usize * 2);
                    let d =
                        (positions[p] - positions[q]).hypot(positions[p + 1] - positions[q + 1]);
                    if d < OVERLAP {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}
