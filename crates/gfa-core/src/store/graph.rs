use crate::analysis::components::{self, Components};
use crate::analysis::stats::{self, Stats};
use crate::layout::Topology;
use crate::parse::builder::{Builder, RecordCounts};
use crate::parse::warnings::{FatalError, Warnings};
use crate::store::csr::Adjacency;
use crate::store::names::Names;
use crate::store::paths::Paths;
use crate::store::seq::{Packed, SeqMode};
use crate::store::{Links, NO_SEQ, Segments};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Gfa,
    Fastg,
}

#[derive(Debug)]
pub struct Graph {
    pub format: Format,
    pub version: Option<String>,
    pub seq_mode: SeqMode,
    pub names: Names,
    pub segments: Segments,
    pub links: Links,
    pub paths: Paths,
    pub packed: Option<Packed>,
    pub adjacency: Adjacency,
    pub components: Components,
    pub stats: Stats,
    pub warnings: Warnings,
    pub counts: RecordCounts,
}

/// Split the way the spec states its memory target: per segment excluding
/// sequence, with name text reported on its own.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryReport {
    pub per_segment: f64,
    pub name_bytes: usize,
    pub link_bytes: usize,
    pub path_bytes: usize,
    pub sequence_bytes: usize,
}

impl Graph {
    pub(crate) fn build(
        mut b: Builder,
        format: Format,
        seq_mode: SeqMode,
    ) -> Result<Self, FatalError> {
        b.close();
        if !(0..b.segments.len() as u32).any(|id| b.segments.is_defined(id)) {
            return Err(FatalError::NoSegments);
        }
        if b.packed.as_ref().is_some_and(|p| p.dropped) {
            b.segments.seq.fill(NO_SEQ);
        }
        let adjacency = Adjacency::build(b.segments.len(), &b.links);
        let components = components::compute(&mut b.segments, &b.links);
        let stats = stats::compute(&b.segments, &adjacency, &components, b.links.len());
        let mut graph = Self {
            format,
            version: b.version,
            seq_mode,
            names: b.names,
            segments: b.segments,
            links: b.links,
            paths: b.paths,
            packed: b.packed,
            adjacency,
            components,
            stats,
            warnings: b.warnings,
            counts: b.counts,
        };
        graph.shrink();
        Ok(graph)
    }

    /// Growth by doubling can leave half of each array unused.
    fn shrink(&mut self) {
        let s = &mut self.segments;
        s.length.shrink_to_fit();
        s.depth.shrink_to_fit();
        s.gc.shrink_to_fit();
        s.seq.shrink_to_fit();
        s.component.shrink_to_fit();
        s.flags.shrink_to_fit();
        let l = &mut self.links;
        l.from.shrink_to_fit();
        l.to.shrink_to_fit();
        l.bits.shrink_to_fit();
        l.overlap_from.shrink_to_fit();
        l.overlap_to.shrink_to_fit();
        self.paths.steps.shrink_to_fit();
        if let Some(p) = &mut self.packed {
            p.bits.shrink_to_fit();
            p.runs.shrink_to_fit();
        }
    }

    pub fn topology(&self) -> Topology<'_> {
        Topology {
            lengths: &self.segments.length,
            components: &self.segments.component,
            link_from: &self.links.from,
            link_to: &self.links.to,
            link_bits: &self.links.bits,
        }
    }

    pub fn memory(&self) -> MemoryReport {
        let fixed = self.segments.heap_bytes()
            + self.names.arena.offset_bytes()
            + self.names.index_bytes()
            + self.adjacency.offsets.capacity() * 4;
        MemoryReport {
            per_segment: fixed as f64 / self.segments.len().max(1) as f64,
            name_bytes: self.names.arena.text_bytes(),
            link_bytes: self.links.heap_bytes()
                + (self.adjacency.targets.capacity() + self.adjacency.links.capacity()) * 4,
            path_bytes: self.paths.heap_bytes(),
            sequence_bytes: self.packed.as_ref().map_or(0, Packed::heap_bytes),
        }
    }
}
