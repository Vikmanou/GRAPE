//! wasm-bindgen bindings around `gfa-core`. Keep this layer thin: conversions
//! and error mapping only, no logic.

use wasm_bindgen::prelude::*;

/// Version of `gfa-core` compiled into this module.
#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    gfa_core::VERSION.to_owned()
}

/// Counts lines in a byte buffer. Returned as `f64` so JS gets a plain number
/// (exact up to 2^53, far beyond any real file's line count).
#[wasm_bindgen(js_name = countLines)]
pub fn count_lines(bytes: &[u8]) -> f64 {
    gfa_core::count_lines(bytes) as f64
}
