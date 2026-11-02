//! Finding DNA queries in a graph's segments: k-mer seeds, banded alignment,
//! then hits joined along the graph's links.

pub mod align;
mod build;
pub mod join;
pub mod kmer;
pub mod links;
pub mod seed;

use join::{Hit, join};
use kmer::KmerIndex;
use links::LinkTable;
use seed::{Skipped, segment_hits};

/// Hits kept per query, best first.
pub const MAX_HITS: usize = 10_000;

/// One query's hits, on top of which `total` were found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Searched {
    pub hits: Vec<Hit>,
    pub total: usize,
    pub skipped: Skipped,
}

pub fn search(index: &KmerIndex, links: &LinkTable, query: &[u8]) -> Searched {
    let query = query.to_ascii_uppercase();
    let mut skipped = Skipped::default();
    if query.len() < index.k() {
        return Searched {
            hits: Vec::new(),
            total: 0,
            skipped,
        };
    }
    let parts = segment_hits(index, &query, &mut skipped);
    let mut hits = join(index, links, &query, parts);
    let total = hits.len();
    hits.truncate(MAX_HITS);
    Searched {
        hits,
        total,
        skipped,
    }
}
