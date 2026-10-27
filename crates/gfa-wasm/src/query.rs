use crate::parse::Loaded;
use gfa_core::analysis::query::{self, SegmentInfo};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Info(SegmentInfo);

#[wasm_bindgen]
impl Info {
    pub fn length(&self) -> u32 {
        self.0.length
    }

    pub fn depth(&self) -> f32 {
        self.0.depth
    }

    pub fn gc(&self) -> f32 {
        self.0.gc
    }

    pub fn component(&self) -> u32 {
        self.0.component
    }

    #[wasm_bindgen(js_name = degreeStart)]
    pub fn degree_start(&self) -> u32 {
        self.0.degree.0
    }

    #[wasm_bindgen(js_name = degreeEnd)]
    pub fn degree_end(&self) -> u32 {
        self.0.degree.1
    }

    #[wasm_bindgen(js_name = totalLinks)]
    pub fn total_links(&self) -> usize {
        self.0.total_links
    }

    /// `other, from, from reverse, to, to reverse` per shown link.
    pub fn links(&self) -> Vec<u32> {
        self.0
            .links
            .iter()
            .flat_map(|l| {
                [
                    l.other,
                    l.from,
                    u32::from(l.from_reverse),
                    l.to,
                    u32::from(l.to_reverse),
                ]
            })
            .collect()
    }
}

#[wasm_bindgen]
pub struct Found {
    ids: Vec<u32>,
    missing: Vec<String>,
}

#[wasm_bindgen]
impl Found {
    pub fn ids(&self) -> Vec<u32> {
        self.ids.clone()
    }

    pub fn missing(&self) -> Vec<String> {
        self.missing.clone()
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[wasm_bindgen]
impl Loaded {
    pub fn info(&self, id: u32, limit: usize) -> Option<Info> {
        query::segment_info(self.graph(), id, limit).map(Info)
    }

    pub fn names(&self, ids: &[u32]) -> Vec<String> {
        ids.iter()
            .map(|&id| text(self.graph().names.get(id)))
            .collect()
    }

    pub fn depths(&self, ids: &[u32]) -> Vec<f32> {
        let depth = &self.graph().segments.depth;
        ids.iter()
            .map(|&id| depth.get(id as usize).copied().unwrap_or(f32::NAN))
            .collect()
    }

    /// `count, total length, length-weighted depth` of the set bits.
    #[wasm_bindgen(js_name = selectionSummary)]
    pub fn selection_summary(&self, bits: &[u32]) -> Vec<f64> {
        let s = query::selection_summary(self.graph(), bits);
        vec![s.count as f64, s.total_length as f64, s.mean_depth]
    }

    #[wasm_bindgen(js_name = findNames)]
    pub fn find_names(&self, names: Vec<String>) -> Found {
        let bytes: Vec<&[u8]> = names.iter().map(String::as_bytes).collect();
        let (ids, missing) = query::find_names(self.graph(), &bytes);
        Found {
            ids,
            missing: missing.into_iter().map(text).collect(),
        }
    }

    #[wasm_bindgen(js_name = exportOrder)]
    pub fn export_order(&self, ids: &[u32]) -> Vec<u32> {
        query::export_order(self.graph(), ids)
    }

    /// Every name back to back, for searching them in JavaScript.
    #[wasm_bindgen(js_name = nameBytes)]
    pub fn name_bytes(&self) -> Vec<u8> {
        self.graph().names.arena.bytes().to_vec()
    }

    #[wasm_bindgen(js_name = nameEnds)]
    pub fn name_ends(&self) -> Vec<u32> {
        self.graph().names.arena.ends().to_vec()
    }
}
