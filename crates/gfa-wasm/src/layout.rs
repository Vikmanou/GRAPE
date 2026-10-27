use gfa_core::layout::Grid as CoreGrid;
use gfa_core::layout::{LayoutOptions, Topology, link_geometry};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Layout {
    inner: gfa_core::layout::Layout,
    links: Vec<u32>,
    pieces: Vec<u32>,
    positions: Vec<f32>,
}

#[wasm_bindgen]
impl Layout {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        lengths: &[u32],
        components: &[u32],
        link_from: &[u32],
        link_to: &[u32],
        link_bits: &[u8],
        seed: u32,
        coarsest_iterations: u32,
        refine_iterations: u32,
    ) -> Result<Layout, JsError> {
        let topology = Topology {
            lengths,
            components,
            link_from,
            link_to,
            link_bits,
        };
        let options = LayoutOptions {
            seed: seed.into(),
            coarsest_iterations,
            refine_iterations,
            ..LayoutOptions::default()
        };
        let inner = gfa_core::layout::Layout::new(topology, options)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let links = link_geometry(&topology, &inner.chains);
        let pieces = inner.chains.pieces();
        Ok(Layout {
            inner,
            links,
            pieces,
            positions: Vec::new(),
        })
    }

    /// Returns whether the layout has finished.
    pub fn step(&mut self, n: u32) -> bool {
        self.inner.step(n)
    }

    pub fn points(&self) -> usize {
        self.inner.points()
    }

    pub fn iteration(&self) -> u32 {
        self.inner.iteration()
    }

    #[wasm_bindgen(js_name = totalIterations)]
    pub fn total_iterations(&self) -> u32 {
        self.inner.total_iterations()
    }

    /// `x, y` per point, components packed apart.
    pub fn positions(&mut self) -> Vec<f32> {
        self.inner.write_positions(&mut self.positions);
        self.positions.clone()
    }

    /// `(first point, segment)` per ribbon piece.
    pub fn pieces(&self) -> Vec<u32> {
        self.pieces.clone()
    }

    /// First point of each segment's chain.
    #[wasm_bindgen(js_name = segmentStarts)]
    pub fn segment_starts(&self) -> Vec<u32> {
        self.inner.chains.start.clone()
    }

    /// Pieces in each segment's chain; it has one more point.
    #[wasm_bindgen(js_name = segmentPieces)]
    pub fn segment_pieces(&self) -> Vec<u8> {
        self.inner.chains.pieces.clone()
    }

    /// `[end a, inner a, end b, inner b]` per link.
    pub fn links(&self) -> Vec<u32> {
        self.links.clone()
    }

    pub fn level(&self) -> usize {
        self.inner.level()
    }

    pub fn levels(&self) -> usize {
        self.inner.levels()
    }

    #[wasm_bindgen(js_name = atLevelZero)]
    pub fn at_level_zero(&self) -> bool {
        self.inner.at_level_zero()
    }

    pub fn pinned(&self) -> usize {
        self.inner.pinned()
    }

    pub fn refining(&self) -> bool {
        self.inner.refining()
    }

    /// Moves a segment and pins it; false before level 0.
    pub fn drag(&mut self, segment: u32, dx: f32, dy: f32) -> bool {
        self.inner.drag(segment, dx, dy)
    }

    #[wasm_bindgen(js_name = unpinAll)]
    pub fn unpin_all(&mut self) {
        self.inner.unpin_all();
    }

    /// Refines level 0 again, moving only the segments whose bit is set in
    /// `selected` when it is given; false before level 0.
    pub fn refine(&mut self, selected: Option<Vec<u32>>) -> bool {
        self.inner.refine(selected.as_deref())
    }

    /// A grid over the positions last returned by `positions`.
    pub fn grid(&self, ribbon_half: f32) -> Grid {
        Grid(CoreGrid::build(
            &self.positions,
            &self.pieces,
            &self.links,
            ribbon_half,
        ))
    }

    /// Only meaningful before the first step; consumes the layout.
    #[wasm_bindgen(js_name = intoHierarchy)]
    pub fn into_hierarchy(self) -> Hierarchy {
        Hierarchy(self.inner.into_hierarchy())
    }
}

#[wasm_bindgen]
pub struct Hierarchy(gfa_core::layout::Hierarchy);

#[wasm_bindgen]
impl Hierarchy {
    pub fn levels(&self) -> usize {
        self.0.levels.len()
    }

    pub fn start(&self) -> Vec<f32> {
        self.0.start.clone()
    }

    pub fn frozen(&self) -> Vec<u8> {
        self.0.frozen.iter().map(|&f| u8::from(f)).collect()
    }

    #[wasm_bindgen(js_name = takeNodes)]
    pub fn take_nodes(&mut self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| std::mem::take(&mut l.nodes))
    }

    #[wasm_bindgen(js_name = takeEdges)]
    pub fn take_edges(&mut self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| std::mem::take(&mut l.edges))
    }

    pub fn heat(&mut self, level: usize) -> Vec<f32> {
        self.level(level).map_or_else(Vec::new, |l| l.heat.clone())
    }

    #[wasm_bindgen(js_name = takeParent)]
    pub fn take_parent(&mut self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| std::mem::take(&mut l.parent))
    }

    #[wasm_bindgen(js_name = takeChildren)]
    pub fn take_children(&mut self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| std::mem::take(&mut l.children))
    }

    pub fn repulsion(&mut self, level: usize) -> f32 {
        self.level(level).map_or(0.0, |l| l.repulsion)
    }

    #[wasm_bindgen(js_name = meanRest)]
    pub fn mean_rest(&mut self, level: usize) -> f32 {
        self.level(level).map_or(0.0, |l| l.mean_rest)
    }

    pub fn iterations(&mut self, level: usize) -> u32 {
        self.level(level).map_or(0, |l| l.iterations)
    }

    fn level(&mut self, level: usize) -> Option<&mut gfa_core::layout::HierarchyLevel> {
        self.0.levels.get_mut(level)
    }
}

#[wasm_bindgen]
pub struct Grid(CoreGrid);

#[wasm_bindgen]
impl Grid {
    /// `min x, min y, cell side, columns, rows`.
    pub fn frame(&self) -> Vec<f32> {
        let g = &self.0;
        vec![g.min_x, g.min_y, g.cell, g.columns as f32, g.rows as f32]
    }

    #[wasm_bindgen(js_name = pieceStarts)]
    pub fn piece_starts(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.pieces.starts)
    }

    #[wasm_bindgen(js_name = pieceItems)]
    pub fn piece_items(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.pieces.items)
    }

    #[wasm_bindgen(js_name = pieceWide)]
    pub fn piece_wide(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.pieces.wide)
    }

    #[wasm_bindgen(js_name = linkStarts)]
    pub fn link_starts(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.links.starts)
    }

    #[wasm_bindgen(js_name = linkItems)]
    pub fn link_items(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.links.items)
    }

    #[wasm_bindgen(js_name = linkWide)]
    pub fn link_wide(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.0.links.wide)
    }
}

/// `x0, y0, x1, y1` per component in, `dx, dy` per component out.
#[wasm_bindgen]
pub fn pack(boxes: &[f32], frozen: &[u8]) -> Vec<f32> {
    let frozen: Vec<bool> = frozen.iter().map(|&f| f != 0).collect();
    if boxes.len() != frozen.len() * 4 {
        return Vec::new();
    }
    gfa_core::layout::pack(boxes, &frozen)
}
