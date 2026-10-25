use gfa_core::layout::{LayoutOptions, Topology, link_geometry};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Layout {
    inner: gfa_core::layout::Layout,
    links: Vec<u32>,
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
        Ok(Layout {
            inner,
            links,
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
        self.inner.chains.pieces()
    }

    /// `[end a, inner a, end b, inner b]` per link.
    pub fn links(&self) -> Vec<u32> {
        self.links.clone()
    }

    /// Only meaningful before the first step.
    pub fn hierarchy(&self) -> Hierarchy {
        Hierarchy(self.inner.hierarchy())
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

    pub fn nodes(&self, level: usize) -> Vec<u32> {
        self.level(level).map_or_else(Vec::new, |l| l.nodes.clone())
    }

    pub fn edges(&self, level: usize) -> Vec<u32> {
        self.level(level).map_or_else(Vec::new, |l| l.edges.clone())
    }

    pub fn heat(&self, level: usize) -> Vec<f32> {
        self.level(level).map_or_else(Vec::new, |l| l.heat.clone())
    }

    pub fn parent(&self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| l.parent.clone())
    }

    pub fn children(&self, level: usize) -> Vec<u32> {
        self.level(level)
            .map_or_else(Vec::new, |l| l.children.clone())
    }

    pub fn repulsion(&self, level: usize) -> f32 {
        self.level(level).map_or(0.0, |l| l.repulsion)
    }

    #[wasm_bindgen(js_name = meanRest)]
    pub fn mean_rest(&self, level: usize) -> f32 {
        self.level(level).map_or(0.0, |l| l.mean_rest)
    }

    pub fn iterations(&self, level: usize) -> u32 {
        self.level(level).map_or(0, |l| l.iterations)
    }

    fn level(&self, level: usize) -> Option<&gfa_core::layout::HierarchyLevel> {
        self.0.levels.get(level)
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
