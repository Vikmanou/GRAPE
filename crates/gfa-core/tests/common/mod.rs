#![allow(dead_code)]

use gfa_core::{FatalError, Graph, ParseOptions, Parser, Stats, parse};
use std::fmt::Write;

pub fn testdata(name: &str) -> Vec<u8> {
    let path = format!("{}/../../testdata/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

pub fn load(name: &str) -> Graph {
    parse(&testdata(name), ParseOptions::default()).unwrap_or_else(|e| panic!("{name}: {e}"))
}

pub fn parse_chunked(
    bytes: &[u8],
    cuts: &[usize],
    options: ParseOptions,
) -> Result<Graph, FatalError> {
    let mut parser = Parser::new(options);
    let mut start = 0;
    for &cut in cuts {
        let cut = cut.clamp(start, bytes.len());
        parser.push(&bytes[start..cut]);
        start = cut;
    }
    parser.push(&bytes[start..]);
    parser.finish()
}

/// Everything a parse produces, with floats as bits so NaN compares equal.
pub fn snapshot(g: &Graph) -> String {
    let mut s = String::new();
    let seg = &g.segments;
    for i in 0..seg.len() {
        let name = String::from_utf8_lossy(g.names.get(i as u32));
        let (depth, gc) = (seg.depth[i].to_bits(), seg.gc[i].to_bits());
        let (len, at, comp, flags) = (seg.length[i], seg.seq[i], seg.component[i], seg.flags[i]);
        let line = seg.line.get(i).copied().unwrap_or(u64::MAX);
        writeln!(
            s,
            "S {name:?} {len} {depth:x} {gc:x} {at} {comp} {flags:x} {line}"
        )
        .unwrap();
    }
    let l = &g.links;
    for i in 0..l.len() {
        writeln!(
            s,
            "L {} {} {:x} {} {}",
            l.from[i], l.to[i], l.bits[i], l.overlap_from[i], l.overlap_to[i]
        )
        .unwrap();
    }
    for i in 0..g.paths.len() {
        let name = String::from_utf8_lossy(g.paths.names.get(i as u32));
        writeln!(s, "P {name:?} {:?} {:?}", g.paths.kind[i], g.paths.steps(i)).unwrap();
    }
    for w in &g.warnings.list {
        writeln!(s, "W {} {:?} {}", w.line, w.kind, w.message).unwrap();
    }
    writeln!(
        s,
        "{:?} {:?} {:?} {}",
        g.counts, g.components, g.packed, g.warnings.total
    )
    .unwrap();
    let st = g.stats;
    let rest = Stats {
        mean_depth: 0.0,
        gc: 0.0,
        ..st
    };
    writeln!(
        s,
        "{rest:?} {:x} {:x}",
        st.mean_depth.to_bits(),
        st.gc.to_bits()
    )
    .unwrap();
    s
}
