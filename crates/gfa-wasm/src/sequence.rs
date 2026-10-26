use gfa_core::write::fasta;
use gfa_core::{Packed, Run, Span, bases_from_file, bases_from_packed};
use wasm_bindgen::prelude::*;

/// Gzipped input's packed bases, moved out of the graph worker.
#[wasm_bindgen]
pub struct PackedParts(pub(crate) Packed);

#[wasm_bindgen]
impl PackedParts {
    pub fn bits(&self) -> Vec<u8> {
        self.0.bits.clone()
    }

    pub fn bases(&self) -> f64 {
        self.0.bases as f64
    }

    #[wasm_bindgen(js_name = runStarts)]
    pub fn run_starts(&self) -> Vec<f64> {
        self.0.runs.iter().map(|r| r.start as f64).collect()
    }

    #[wasm_bindgen(js_name = runLengths)]
    pub fn run_lengths(&self) -> Vec<u32> {
        self.0.runs.iter().map(|r| r.len).collect()
    }

    #[wasm_bindgen(js_name = runBytes)]
    pub fn run_bytes(&self) -> Vec<u8> {
        self.0.runs.iter().map(|r| r.byte).collect()
    }

    #[wasm_bindgen(js_name = lowerStarts)]
    pub fn lower_starts(&self) -> Vec<f64> {
        self.0.lower.iter().map(|s| s.start as f64).collect()
    }

    #[wasm_bindgen(js_name = lowerLengths)]
    pub fn lower_lengths(&self) -> Vec<u32> {
        self.0.lower.iter().map(|s| s.len).collect()
    }
}

/// The sequence worker's copy of the packed bases.
#[wasm_bindgen]
pub struct PackedSequences(Packed);

#[wasm_bindgen]
impl PackedSequences {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        bits: Vec<u8>,
        bases: f64,
        run_starts: &[f64],
        run_lengths: &[u32],
        run_bytes: &[u8],
        lower_starts: &[f64],
        lower_lengths: &[u32],
    ) -> PackedSequences {
        let runs = run_starts
            .iter()
            .zip(run_lengths)
            .zip(run_bytes)
            .map(|((&start, &len), &byte)| Run {
                start: start as u64,
                len,
                byte,
            })
            .collect();
        let lower = lower_starts
            .iter()
            .zip(lower_lengths)
            .map(|(&start, &len)| Span {
                start: start as u64,
                len,
            })
            .collect();
        PackedSequences(Packed::from_parts(bits, bases as u64, runs, lower))
    }

    pub fn bases(&self, start: f64, length: u32, flags: u8) -> Option<Vec<u8>> {
        bases_from_packed(&self.0, start as u64, length, flags)
    }
}

/// `None` when `bytes` stops before the sequence does; read more and retry.
#[wasm_bindgen(js_name = basesFromFile)]
pub fn bases_from_file_bytes(bytes: &[u8], length: u32, flags: u8) -> Option<Vec<u8>> {
    bases_from_file(bytes, length, flags)
}

#[wasm_bindgen(js_name = fastaRecord)]
pub fn fasta_record(name: &[u8], length: u32, depth: f32, bases: Option<Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    fasta::write_record(&mut out, name, length, depth, bases.as_deref());
    out
}
