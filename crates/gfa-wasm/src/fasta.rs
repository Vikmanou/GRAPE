use crate::parse::Loaded;
use gfa_core::FastaIndexer;
use wasm_bindgen::prelude::*;

/// Streams a FASTA file whose records give the loaded graph its sequences.
#[wasm_bindgen]
pub struct FastaReader {
    inner: Option<FastaIndexer>,
}

#[wasm_bindgen]
impl FastaReader {
    /// `packed` keeps the bases, for gzipped input.
    #[wasm_bindgen(constructor)]
    pub fn new(packed: bool) -> FastaReader {
        FastaReader {
            inner: Some(FastaIndexer::new(packed)),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        if let Some(indexer) = &mut self.inner {
            indexer.push(chunk);
        }
    }
}

#[wasm_bindgen]
impl Loaded {
    /// `matched, unknown records, resized segments, dropped (1 or 0)`.
    #[wasm_bindgen(js_name = attachFasta)]
    pub fn attach_fasta(&mut self, reader: &mut FastaReader) -> Result<Vec<f64>, JsError> {
        let indexer = reader
            .inner
            .take()
            .ok_or_else(|| JsError::new("the FASTA was already attached"))?;
        let a = indexer.attach(self.graph_mut());
        Ok(vec![
            a.matched as f64,
            a.unknown as f64,
            a.resized as f64,
            f64::from(u8::from(a.dropped)),
        ])
    }
}
