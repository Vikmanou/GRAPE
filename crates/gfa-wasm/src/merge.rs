use crate::parse::Loaded;
use gfa_core::DepthTag;
use gfa_core::analysis::merge;
use gfa_core::write::gfa;
use wasm_bindgen::prelude::*;

/// A merged graph, and the steps through the original graph that spell each of its segments.
#[wasm_bindgen]
pub struct MergeResult {
    graph: Option<Loaded>,
    step_ends: Vec<u32>,
    steps: Vec<u32>,
    trims: Vec<u32>,
    chains: usize,
}

#[wasm_bindgen]
impl MergeResult {
    /// The merged graph; the result keeps the steps only.
    #[wasm_bindgen(js_name = takeGraph)]
    pub fn take_graph(&mut self) -> Option<Loaded> {
        self.graph.take()
    }

    #[wasm_bindgen(js_name = stepEnds)]
    pub fn step_ends(&self) -> Vec<u32> {
        self.step_ends.clone()
    }

    pub fn steps(&self) -> Vec<u32> {
        self.steps.clone()
    }

    pub fn trims(&self) -> Vec<u32> {
        self.trims.clone()
    }

    pub fn chains(&self) -> usize {
        self.chains
    }
}

pub(crate) fn depth_tag_code(tag: DepthTag) -> u8 {
    match tag {
        DepthTag::None => 0,
        DepthTag::Dp => 1,
        DepthTag::Kc => 2,
        DepthTag::Rc => 3,
        DepthTag::Fc => 4,
    }
}

pub(crate) fn depth_tag(code: u8) -> DepthTag {
    match code {
        1 => DepthTag::Dp,
        2 => DepthTag::Kc,
        3 => DepthTag::Rc,
        4 => DepthTag::Fc,
        _ => DepthTag::None,
    }
}

#[wasm_bindgen]
impl Loaded {
    pub fn merge(&self) -> Result<MergeResult, JsError> {
        let m = merge::merge(self.graph()).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(MergeResult {
            graph: Some(Loaded::from_graph(m.graph)),
            step_ends: m.step_ends,
            steps: m.steps,
            trims: m.trims,
            chains: m.chains,
        })
    }

    /// Segments in the order Bandage saves them to GFA.
    #[wasm_bindgen(js_name = gfaOrder)]
    pub fn gfa_order(&self) -> Vec<u32> {
        gfa::segment_order(self.graph())
    }

    /// The LB, L2, CL and C2 fields of each segment's line.
    #[wasm_bindgen(js_name = gfaCustom)]
    pub fn gfa_custom(&self, segments: &[u32]) -> Vec<String> {
        segments
            .iter()
            .map(|&s| String::from_utf8_lossy(&gfa::custom_fields(self.graph(), s)).into_owned())
            .collect()
    }

    /// 0 none, 1 DP, 2 KC, 3 RC, 4 FC.
    #[wasm_bindgen(js_name = depthTag)]
    pub fn depth_tag(&self) -> u8 {
        depth_tag_code(self.graph().depth_tag)
    }

    /// Every L line, as Bandage saves them.
    #[wasm_bindgen(js_name = gfaLinks)]
    pub fn gfa_links(&self) -> Vec<u8> {
        let mut out = Vec::new();
        gfa::write_links(&mut out, self.graph());
        out
    }
}
