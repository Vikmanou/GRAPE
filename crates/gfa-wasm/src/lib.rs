//! wasm-bindgen bindings around `gfa-core`: conversions and error mapping only.

mod layout;
mod parse;

pub use layout::{Hierarchy, Layout, pack};
pub use parse::{Loaded, Parser, Summary};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    gfa_core::VERSION.to_owned()
}
