//! Core of GRAPE: GFA and FASTG parsing, the graph store, graph algorithms,
//! stats and sequence search. Pure Rust with no browser dependencies, so
//! everything here is tested natively.

mod analysis;
pub mod layout;
mod parse;
mod store;

pub use analysis::components::Components;
pub use analysis::stats::Stats;
pub use parse::builder::RecordCounts;
pub use parse::parser::{ParseOptions, Parser, parse};
pub use parse::warnings::{FatalError, MAX_STORED, Severity, Warning, WarningKind, Warnings};
pub use store::graph::{Format, Graph, MemoryReport};
pub use store::names::{Arena, Names};
pub use store::paths::{PathKind, Paths, REVERSE};
pub use store::seq::{DEFAULT_BUDGET, Packed, Run, SeqMode};
pub use store::{Links, NO_SEQ, Segments, csr, link_bits, seg_flags};

/// Version of this crate, reported to the UI so a stale WASM build is visible.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
