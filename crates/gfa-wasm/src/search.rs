use gfa_core::search::kmer::{IndexBuilder, KmerIndex};
use gfa_core::search::links::LinkTable;
use gfa_core::search::search;
use wasm_bindgen::prelude::*;

/// Built in steps, so the worker stays able to hear a cancel.
#[wasm_bindgen]
pub struct SearchIndexBuilder(IndexBuilder);

#[wasm_bindgen]
impl SearchIndexBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new(segments: usize, k: usize) -> SearchIndexBuilder {
        SearchIndexBuilder(IndexBuilder::new(segments, k))
    }

    pub fn add(&mut self, segment: u32, bases: &[u8]) -> Result<(), JsError> {
        self.0
            .add(segment, bases)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn plan(&mut self) -> Result<(), JsError> {
        self.0.plan().map_err(|e| JsError::new(&e.to_string()))
    }

    /// Does about `bases` bases of work; true once the index can be finished.
    pub fn step(&mut self, bases: f64) -> Result<bool, JsError> {
        self.0
            .step(bases as u64)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn progress(&self) -> f64 {
        self.0.progress()
    }

    /// Takes the shown graph's links, as `Links` holds them, for joining hits.
    pub fn finish(
        self,
        from: &[u32],
        to: &[u32],
        bits: &[u8],
        overlap_from: &[u32],
        overlap_to: &[u32],
    ) -> SearchIndex {
        let index = self.0.finish();
        let links = LinkTable::new(index.segments(), from, to, bits, overlap_from, overlap_to);
        SearchIndex { index, links }
    }
}

#[wasm_bindgen]
pub struct SearchIndex {
    index: KmerIndex,
    links: LinkTable,
}

#[wasm_bindgen]
impl SearchIndex {
    pub fn k(&self) -> usize {
        self.index.k()
    }

    #[wasm_bindgen(js_name = guaranteedMatch)]
    pub fn guaranteed_match(&self) -> usize {
        self.index.guaranteed_match()
    }

    #[wasm_bindgen(js_name = indexedSegments)]
    pub fn indexed_segments(&self) -> usize {
        self.index.indexed_segments()
    }

    #[wasm_bindgen(js_name = indexedBases)]
    pub fn indexed_bases(&self) -> f64 {
        self.index.indexed_bases() as f64
    }

    #[wasm_bindgen(js_name = heapBytes)]
    pub fn heap_bytes(&self) -> f64 {
        (self.index.heap_bytes() + self.links.heap_bytes()) as f64
    }

    pub fn search(&self, query: &[u8]) -> SearchHits {
        let found = search(&self.index, &self.links, query);
        let mut hits = Vec::with_capacity(found.hits.len() * 6);
        let mut parts = Vec::new();
        for hit in &found.hits {
            for part in &hit.parts {
                let (start, end) = part.forward(self.index.length(part.segment));
                parts.extend([
                    part.segment,
                    u32::from(part.reverse),
                    part.q_start,
                    part.q_end,
                    start,
                    end,
                ]);
            }
            hits.extend([
                hit.score as u32,
                hit.q_start,
                hit.q_end,
                hit.matches,
                hit.columns,
                hit.parts.len() as u32,
            ]);
        }
        SearchHits {
            hits,
            parts,
            total: found.total as u32,
            repeats: found.skipped.repeats as f64,
            seeds_cut: found.skipped.seeds,
        }
    }
}

/// `HIT_WORDS` and `PART_WORDS` in web/src/workers/protocol/sequence.ts.
#[wasm_bindgen]
pub struct SearchHits {
    hits: Vec<u32>,
    parts: Vec<u32>,
    total: u32,
    repeats: f64,
    seeds_cut: bool,
}

#[wasm_bindgen]
impl SearchHits {
    pub fn hits(&self) -> Vec<u32> {
        self.hits.clone()
    }

    pub fn parts(&self) -> Vec<u32> {
        self.parts.clone()
    }

    pub fn total(&self) -> u32 {
        self.total
    }

    pub fn repeats(&self) -> f64 {
        self.repeats
    }

    #[wasm_bindgen(js_name = seedsCut)]
    pub fn seeds_cut(&self) -> bool {
        self.seeds_cut
    }
}
