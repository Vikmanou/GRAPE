use crate::parse::Loaded;
use gfa_core::PathKind;
use gfa_core::analysis::paths;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Loaded {
    #[wasm_bindgen(js_name = pathNames)]
    pub fn path_names(&self) -> Vec<String> {
        let names = &self.graph().paths.names;
        (0..names.len() as u32)
            .map(|i| String::from_utf8_lossy(names.get(i)).into_owned())
            .collect()
    }

    /// 1 for walks (W), 0 for paths (P).
    #[wasm_bindgen(js_name = pathKinds)]
    pub fn path_kinds(&self) -> Vec<u8> {
        let kinds = &self.graph().paths.kind;
        kinds
            .iter()
            .map(|&k| u8::from(k == PathKind::Walk))
            .collect()
    }

    #[wasm_bindgen(js_name = pathStepCounts)]
    pub fn path_step_counts(&self) -> Vec<u32> {
        let p = &self.graph().paths;
        (0..p.len()).map(|i| p.steps(i).len() as u32).collect()
    }

    #[wasm_bindgen(js_name = pathLengths)]
    pub fn path_lengths(&self) -> Vec<f64> {
        let g = self.graph();
        (0..g.paths.len())
            .map(|i| paths::path_length(g, i) as f64)
            .collect()
    }

    /// Segment ids with the high bit set for reverse steps.
    #[wasm_bindgen(js_name = pathSteps)]
    pub fn path_steps(&self, path: usize) -> Vec<u32> {
        let p = &self.graph().paths;
        if path < p.len() {
            p.steps(path).to_vec()
        } else {
            Vec::new()
        }
    }
}
