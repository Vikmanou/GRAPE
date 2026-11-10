//! The drawing geometry around positions given rather than laid out, such as
//! a BandageNG layout file's, with no layout run: the chains and links a
//! layout of the same topology draws, so the positions line up point for point.

use super::{Chains, LayoutOptions, Topology, TopologyError, link_geometry};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedError {
    Topology(TopologyError),
    /// Lines given for another number of segments, or with coordinates that are not finite.
    Lines,
}

impl std::fmt::Display for FixedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FixedError::Topology(e) => e.fmt(f),
            FixedError::Lines => f.write_str("the layout's lines do not fit this graph"),
        }
    }
}

impl std::error::Error for FixedError {}

pub struct Fixed {
    pub chains: Chains,
    /// `(first point, segment)` per ribbon piece.
    pub pieces: Vec<u32>,
    /// `[end a, inner a, end b, inner b]` per link.
    pub links: Vec<u32>,
}

impl Fixed {
    pub fn new(t: &Topology) -> Result<Fixed, FixedError> {
        t.validate().map_err(FixedError::Topology)?;
        let chains = Chains::build(t, LayoutOptions::default().max_pieces);
        let links = link_geometry(t, &chains);
        let pieces = chains.pieces();
        Ok(Fixed {
            chains,
            pieces,
            links,
        })
    }
}

/// Every chain point from one line per segment, as BandageNG's layout files
/// give them (`layout/io.cpp`: node name to its drawn line points). A line is
/// resampled along its length onto its segment's chain, and all lines are
/// scaled by the median ratio of chain length to line length, as Bandage's
/// units are not these. When every line already has its chain's number of
/// points, as in a file GRAPE wrote, the points are kept as they are.
///
/// `starts` holds `segments + 1` offsets, in points, into `lines` (`x, y`
/// pairs). A segment with no points is not drawn (BandageNG's
/// `layout::apply`); its points go to the middle of the drawn ones. Returns
/// the positions and one flag per segment, set when drawn.
pub fn positions_from_lines(
    chains: &Chains,
    lines: &[f32],
    starts: &[u32],
) -> Result<(Vec<f32>, Vec<bool>), FixedError> {
    let n = chains.start.len();
    if starts.len() != n + 1
        || starts.windows(2).any(|w| w[0] > w[1])
        || starts[n] as usize * 2 != lines.len()
        || lines.iter().any(|v| !v.is_finite())
    {
        return Err(FixedError::Lines);
    }
    let line = |s: usize| &lines[starts[s] as usize * 2..starts[s + 1] as usize * 2];
    let length = |l: &[f32]| -> f32 {
        l.as_chunks::<2>()
            .0
            .windows(2)
            .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
            .sum()
    };
    let drawn: Vec<bool> = (0..n).map(|s| !line(s).is_empty()).collect();
    let own = (0..n).all(|s| !drawn[s] || line(s).len() == 2 * (usize::from(chains.pieces[s]) + 1));
    let scale = if own {
        1.0
    } else {
        let mut ratios: Vec<f32> = (0..n)
            .filter_map(|s| {
                let along = length(line(s));
                let chain = chains.piece_length[s] * f32::from(chains.pieces[s]);
                (along > 0.0 && chain > 0.0).then(|| chain / along)
            })
            .collect();
        ratios.sort_by(f32::total_cmp);
        ratios.get(ratios.len() / 2).copied().unwrap_or(1.0)
    };

    let mut positions = vec![0.0f32; chains.points() * 2];
    let (mut sum_x, mut sum_y, mut count) = (0.0f64, 0.0f64, 0usize);
    for s in (0..n).filter(|&s| drawn[s]) {
        let l = line(s);
        let pieces = usize::from(chains.pieces[s]);
        let first = chains.start[s] as usize;
        let along = length(l);
        for j in 0..=pieces {
            let [x, y] = if own {
                [l[2 * j], l[2 * j + 1]]
            } else if along > 0.0 {
                point_along(l, along * j as f32 / pieces as f32)
            } else {
                // One point, or all on top of each other: lay the chain out flat around it.
                let chain = chains.piece_length[s] * pieces as f32;
                [
                    l[0] + (j as f32 / pieces as f32 - 0.5) * chain / scale,
                    l[1],
                ]
            };
            positions[2 * (first + j)] = x * scale;
            positions[2 * (first + j) + 1] = y * scale;
            sum_x += f64::from(x * scale);
            sum_y += f64::from(y * scale);
            count += 1;
        }
    }
    let middle = [
        (sum_x / count.max(1) as f64) as f32,
        (sum_y / count.max(1) as f64) as f32,
    ];
    for s in (0..n).filter(|&s| !drawn[s]) {
        let first = chains.start[s] as usize;
        for p in first..=first + usize::from(chains.pieces[s]) {
            positions[2 * p] = middle[0];
            positions[2 * p + 1] = middle[1];
        }
    }
    Ok((positions, drawn))
}

/// The point `distance` along a line of `x, y` pairs.
fn point_along(line: &[f32], distance: f32) -> [f32; 2] {
    let mut left = distance;
    for w in line.as_chunks::<2>().0.windows(2) {
        let [a, b] = [w[0], w[1]];
        let step = (b[0] - a[0]).hypot(b[1] - a[1]);
        if step > 0.0 && left <= step {
            let t = left / step;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        left -= step;
    }
    [line[line.len() - 2], line[line.len() - 1]]
}
