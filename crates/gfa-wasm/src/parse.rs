use crate::sequence::PackedParts;
use gfa_core::NO_SEQ;
use gfa_core::{DEFAULT_BUDGET, Format, Graph, ParseOptions, PathKind, SeqMode, Severity};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Parser {
    inner: Option<gfa_core::Parser>,
}

#[wasm_bindgen]
impl Parser {
    /// `packed` keeps sequences in memory, for input that cannot be re-read
    /// by offset (gzip).
    #[wasm_bindgen(constructor)]
    pub fn new(packed: bool) -> Parser {
        let seq_mode = if packed {
            SeqMode::Packed {
                budget_bytes: DEFAULT_BUDGET,
            }
        } else {
            SeqMode::FileOffsets
        };
        Parser {
            inner: Some(gfa_core::Parser::new(ParseOptions { seq_mode })),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        if let Some(parser) = &mut self.inner {
            parser.push(chunk);
        }
    }

    pub fn finish(&mut self) -> Result<Loaded, JsError> {
        let parser = self
            .inner
            .take()
            .ok_or_else(|| JsError::new("parser already finished"))?;
        let graph = parser.finish().map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Loaded { graph })
    }
}

#[wasm_bindgen]
pub struct Loaded {
    graph: Graph,
}

impl Loaded {
    pub(crate) fn graph(&self) -> &Graph {
        &self.graph
    }

    fn tag_colors(&self, second: bool) -> &[(u32, u32)] {
        let custom = &self.graph.custom;
        if second {
            &custom.color2
        } else {
            &custom.color
        }
    }
}

/// Numbers cross as `f64`, exact up to 2^53.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct Summary {
    pub segments: f64,
    pub undefined: f64,
    pub links: f64,
    #[wasm_bindgen(js_name = totalLength)]
    pub total_length: f64,
    pub n50: f64,
    pub n75: f64,
    pub longest: f64,
    pub shortest: f64,
    pub components: f64,
    #[wasm_bindgen(js_name = largestComponentLength)]
    pub largest_component_length: f64,
    #[wasm_bindgen(js_name = largestComponentSegments)]
    pub largest_component_segments: f64,
    #[wasm_bindgen(js_name = deadEnds)]
    pub dead_ends: f64,
    pub isolated: f64,
    #[wasm_bindgen(js_name = meanDepth)]
    pub mean_depth: f64,
    pub gc: f64,
    pub paths: f64,
    pub walks: f64,
    pub containments: f64,
    #[wasm_bindgen(js_name = duplicateLinks)]
    pub duplicate_links: f64,
    #[wasm_bindgen(js_name = depthQ1)]
    pub depth_q1: f64,
    #[wasm_bindgen(js_name = depthQ3)]
    pub depth_q3: f64,
    #[wasm_bindgen(js_name = depthMin)]
    pub depth_min: f64,
    #[wasm_bindgen(js_name = depthMax)]
    pub depth_max: f64,
    #[wasm_bindgen(js_name = gcMin)]
    pub gc_min: f64,
    #[wasm_bindgen(js_name = gcMax)]
    pub gc_max: f64,
    #[wasm_bindgen(js_name = bytesPerSegment)]
    pub bytes_per_segment: f64,
    #[wasm_bindgen(js_name = nameBytes)]
    pub name_bytes: f64,
    #[wasm_bindgen(js_name = sequenceBytes)]
    pub sequence_bytes: f64,
    #[wasm_bindgen(js_name = sequencesDropped)]
    pub sequences_dropped: bool,
}

#[wasm_bindgen]
impl Loaded {
    pub fn format(&self) -> String {
        match self.graph.format {
            Format::Gfa => "gfa",
            Format::Fastg => "fastg",
        }
        .to_owned()
    }

    pub fn version(&self) -> Option<String> {
        self.graph.version.clone()
    }

    pub fn summary(&self) -> Summary {
        let g = &self.graph;
        let s = g.stats;
        let memory = g.memory();
        let n = |v: u64| v as f64;
        Summary {
            segments: n(s.segments),
            undefined: n(s.undefined),
            links: n(s.links),
            total_length: n(s.total_length),
            n50: s.n50.into(),
            n75: s.n75.into(),
            longest: s.longest.into(),
            shortest: s.shortest.into(),
            components: n(s.components),
            largest_component_length: n(s.largest_component_length),
            largest_component_segments: n(s.largest_component_segments),
            dead_ends: n(s.dead_ends),
            isolated: n(s.isolated),
            mean_depth: s.mean_depth,
            gc: s.gc,
            paths: g.paths.count(PathKind::Path) as f64,
            walks: g.paths.count(PathKind::Walk) as f64,
            containments: n(g.counts.containments),
            duplicate_links: n(g.counts.duplicate_links),
            depth_q1: s.depth_q1,
            depth_q3: s.depth_q3,
            depth_min: s.depth_min,
            depth_max: s.depth_max,
            gc_min: s.gc_min,
            gc_max: s.gc_max,
            bytes_per_segment: memory.per_segment,
            name_bytes: memory.name_bytes as f64,
            sequence_bytes: memory.sequence_bytes as f64,
            sequences_dropped: g.packed.as_ref().is_some_and(|p| p.dropped),
        }
    }

    #[wasm_bindgen(js_name = segmentLengths)]
    pub fn segment_lengths(&self) -> Vec<u32> {
        self.graph.segments.length.clone()
    }

    #[wasm_bindgen(js_name = segmentComponents)]
    pub fn segment_components(&self) -> Vec<u32> {
        self.graph.segments.component.clone()
    }

    #[wasm_bindgen(js_name = segmentDepths)]
    pub fn segment_depths(&self) -> Vec<f32> {
        self.graph.segments.depth.clone()
    }

    #[wasm_bindgen(js_name = segmentGc)]
    pub fn segment_gc(&self) -> Vec<f32> {
        self.graph.segments.gc.clone()
    }

    /// Segments with a CL tag, ascending; `second` for C2.
    #[wasm_bindgen(js_name = tagColorSegments)]
    pub fn tag_color_segments(&self, second: bool) -> Vec<u32> {
        self.tag_colors(second).iter().map(|e| e.0).collect()
    }

    /// RGBA8 with red in the low byte, matching `tagColorSegments`.
    #[wasm_bindgen(js_name = tagColors)]
    pub fn tag_colors_rgba(&self, second: bool) -> Vec<u32> {
        self.tag_colors(second).iter().map(|e| e.1).collect()
    }

    #[wasm_bindgen(js_name = linkFrom)]
    pub fn link_from(&self) -> Vec<u32> {
        self.graph.links.from.clone()
    }

    #[wasm_bindgen(js_name = linkTo)]
    pub fn link_to(&self) -> Vec<u32> {
        self.graph.links.to.clone()
    }

    #[wasm_bindgen(js_name = linkBits)]
    pub fn link_bits(&self) -> Vec<u8> {
        self.graph.links.bits.clone()
    }

    /// Per segment: file byte offset (plain) or packed base offset (gzipped), -1 for none.
    #[wasm_bindgen(js_name = sequenceOffsets)]
    pub fn sequence_offsets(&self) -> Vec<f64> {
        let at = |&o: &u64| if o == NO_SEQ { -1.0 } else { o as f64 };
        self.graph.segments.seq.iter().map(at).collect()
    }

    #[wasm_bindgen(js_name = segmentFlags)]
    pub fn segment_flags(&self) -> Vec<u8> {
        self.graph.segments.flags.clone()
    }

    /// Empty for gzipped input.
    #[wasm_bindgen(js_name = lineOffsets)]
    pub fn line_offsets(&self) -> Vec<f64> {
        self.graph.segments.line.iter().map(|&o| o as f64).collect()
    }

    /// Moves the packed bases out; the sequence worker owns them from then on.
    #[wasm_bindgen(js_name = takePacked)]
    pub fn take_packed(&mut self) -> Option<PackedParts> {
        self.graph
            .packed
            .take()
            .filter(|p| !p.dropped)
            .map(PackedParts)
    }

    #[wasm_bindgen(js_name = componentSegments)]
    pub fn component_segments(&self) -> Vec<u32> {
        self.graph.components.segments.clone()
    }

    #[wasm_bindgen(js_name = componentLengths)]
    pub fn component_lengths(&self) -> Vec<f64> {
        self.graph
            .components
            .length
            .iter()
            .map(|&l| l as f64)
            .collect()
    }

    #[wasm_bindgen(js_name = warningTotal)]
    pub fn warning_total(&self) -> f64 {
        self.graph.warnings.total as f64
    }

    #[wasm_bindgen(js_name = warningLines)]
    pub fn warning_lines(&self) -> Vec<f64> {
        self.graph
            .warnings
            .list
            .iter()
            .map(|w| w.line as f64)
            .collect()
    }

    /// 1 for errors, 0 for warnings.
    #[wasm_bindgen(js_name = warningSeverities)]
    pub fn warning_severities(&self) -> Vec<u8> {
        self.graph
            .warnings
            .list
            .iter()
            .map(|w| u8::from(w.severity == Severity::Error))
            .collect()
    }

    #[wasm_bindgen(js_name = warningMessages)]
    pub fn warning_messages(&self) -> Vec<String> {
        self.graph
            .warnings
            .list
            .iter()
            .map(|w| w.message.clone())
            .collect()
    }
}
