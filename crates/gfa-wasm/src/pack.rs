use wasm_bindgen::prelude::*;

/// A file packed for a share link, or nothing if it would pass `limit` bytes.
#[wasm_bindgen(js_name = packFile)]
pub fn pack_file(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    gfa_core::pack::pack_within(bytes, limit)
}

#[wasm_bindgen(js_name = unpackFile)]
pub fn unpack_file(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    gfa_core::pack::unpack(bytes).map_err(|e| JsError::new(&e.to_string()))
}
