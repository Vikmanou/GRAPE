//! A uniform grid over the drawn ribbon pieces and links, so a renderer
//! without compute shaders can find what touches the view, a box or a label
//! on the CPU (spec, Rendering: WebGL2 backend).

/// Items whose box covers more cells than this go on the wide list, which
/// every query returns, instead of filling the grid.
const WIDE_CELLS: u64 = 16;
/// Aimed for on average, which keeps queries short and the lists small.
const ITEMS_PER_CELL: f32 = 4.0;
const MAX_SIDE: u32 = 4096;

/// For each cell, the items whose box overlaps it.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct CellLists {
    /// `starts[c]..starts[c + 1]` indexes `items` for cell `c`, row major.
    pub starts: Vec<u32>,
    pub items: Vec<u32>,
    pub wide: Vec<u32>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Grid {
    pub min_x: f32,
    pub min_y: f32,
    pub cell: f32,
    pub columns: u32,
    pub rows: u32,
    pub pieces: CellLists,
    pub links: CellLists,
}

type Box2 = [f32; 4];

impl Grid {
    /// `positions` is `x, y` per point, `pieces` `first point, segment` per
    /// ribbon piece and `links` `end a, inner a, end b, inner b` per link.
    /// Boxes carry no width: queries pad by how wide ribbons draw.
    pub fn build(positions: &[f32], pieces: &[u32], links: &[u32], ribbon_half: f32) -> Grid {
        let at = |p: u32| {
            let i = p as usize * 2;
            (
                positions.get(i).copied().unwrap_or(0.0),
                positions.get(i + 1).copied().unwrap_or(0.0),
            )
        };
        let piece_boxes: Vec<Box2> = pieces
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| {
                let ((ax, ay), (bx, by)) = (at(p[0]), at(p[0] + 1));
                [ax.min(bx), ay.min(by), ax.max(bx), ay.max(by)]
            })
            .collect();
        // Mirrors `mark_links` in cull.wgsl: a link's curve stays inside its
        // control points, at most 1.5 reaches from its ends.
        let link_boxes: Vec<Box2> = links
            .as_chunks::<4>()
            .0
            .iter()
            .map(|l| {
                let ((ax, ay), (bx, by)) = (at(l[0]), at(l[2]));
                let reach = ((bx - ax).hypot(by - ay) * 0.4).max(ribbon_half * 6.0) * 1.5;
                [
                    ax.min(bx) - reach,
                    ay.min(by) - reach,
                    ax.max(bx) + reach,
                    ay.max(by) + reach,
                ]
            })
            .collect();

        let mut grid = Grid::sized(&piece_boxes, &link_boxes);
        grid.pieces = grid.fill(&piece_boxes);
        grid.links = grid.fill(&link_boxes);
        grid
    }

    fn sized(pieces: &[Box2], links: &[Box2]) -> Grid {
        let mut bounds = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for b in pieces
            .iter()
            .chain(links)
            .filter(|b| b.iter().all(|v| v.is_finite()))
        {
            bounds = [
                bounds[0].min(b[0]),
                bounds[1].min(b[1]),
                bounds[2].max(b[2]),
                bounds[3].max(b[3]),
            ];
        }
        if bounds[0] > bounds[2] {
            bounds = [0.0, 0.0, 1.0, 1.0];
        }
        let (w, h) = (
            (bounds[2] - bounds[0]).max(1.0),
            (bounds[3] - bounds[1]).max(1.0),
        );
        let cells = (pieces.len() as f32 / ITEMS_PER_CELL).max(1.0);
        let side_limit = (w.max(h) / MAX_SIDE as f32).max(1.0);
        let cell = (w * h / cells).sqrt().max(side_limit);
        Grid {
            min_x: bounds[0],
            min_y: bounds[1],
            cell,
            columns: ((w / cell).ceil() as u32).clamp(1, MAX_SIDE),
            rows: ((h / cell).ceil() as u32).clamp(1, MAX_SIDE),
            ..Grid::default()
        }
    }

    /// Cells covered by a box, clamped to the grid: `(c0, r0, c1, r1)`, inclusive.
    pub fn cells(&self, b: &Box2) -> (u32, u32, u32, u32) {
        let col =
            |x: f32| (((x - self.min_x) / self.cell).floor().max(0.0) as u32).min(self.columns - 1);
        let row =
            |y: f32| (((y - self.min_y) / self.cell).floor().max(0.0) as u32).min(self.rows - 1);
        (col(b[0]), row(b[1]), col(b[2]), row(b[3]))
    }

    fn covered(&self, b: &Box2) -> Option<(u32, u32, u32, u32)> {
        if !b.iter().all(|v| v.is_finite()) {
            return None;
        }
        Some(self.cells(b))
    }

    fn fill(&self, boxes: &[Box2]) -> CellLists {
        let cells = (self.columns * self.rows) as usize;
        let mut starts = vec![0u32; cells + 1];
        let mut wide = Vec::new();
        let span = |(c0, r0, c1, r1): (u32, u32, u32, u32)| {
            u64::from(c1 - c0 + 1) * u64::from(r1 - r0 + 1)
        };
        for (i, b) in boxes.iter().enumerate() {
            let Some(c) = self.covered(b) else {
                wide.push(i as u32);
                continue;
            };
            if span(c) > WIDE_CELLS {
                wide.push(i as u32);
                continue;
            }
            for r in c.1..=c.3 {
                for col in c.0..=c.2 {
                    starts[(r * self.columns + col) as usize + 1] += 1;
                }
            }
        }
        for k in 0..cells {
            starts[k + 1] += starts[k];
        }
        let mut fill = starts.clone();
        let mut items = vec![0u32; starts[cells] as usize];
        for (i, b) in boxes.iter().enumerate() {
            let Some(c) = self.covered(b).filter(|&c| span(c) <= WIDE_CELLS) else {
                continue;
            };
            for r in c.1..=c.3 {
                for col in c.0..=c.2 {
                    let cell = (r * self.columns + col) as usize;
                    items[fill[cell] as usize] = i as u32;
                    fill[cell] += 1;
                }
            }
        }
        CellLists {
            starts,
            items,
            wide,
        }
    }
}
