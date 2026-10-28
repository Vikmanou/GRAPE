//! wasm-bindgen bindings around `gfa-core`: conversions and error mapping only.

mod layout;
mod merge;
mod parse;
mod paths;
mod query;
mod sequence;

pub use layout::{Hierarchy, Layout, pack};
pub use merge::MergeResult;
pub use parse::{Loaded, Parser, Summary};
pub use query::{Found, Info};
pub use sequence::{
    PackedParts, PackedSequences, bases_from_file_bytes, fasta_record, gfa_segment_line,
    reverse_complement,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    gfa_core::VERSION.to_owned()
}
