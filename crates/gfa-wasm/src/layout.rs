use gfa_core::layout::{LayoutOptions, Topology, link_geometry};
use wasm_bindgen::prelude::*;

/// A layout run, stepped by the layout worker.
#[wasm_bindgen]
pub struct Layout {
    inner: gfa_core::layout::Layout,
    links: Vec<u32>,
    positions: Vec<f32>,
}

#[wasm_bindgen]
impl Layout {
    #[wasm_bindgen(constructor)]
    pub fn new(
        lengths: &[u32],
        components: &[u32],
        link_from: &[u32],
        link_to: &[u32],
        link_bits: &[u8],
        seed: u32,
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

    /// Runs up to `n` iterations; returns whether the layout has finished.
    pub fn step(&mut self, n: u32) -> bool {
        self.inner.step(n)
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
}
