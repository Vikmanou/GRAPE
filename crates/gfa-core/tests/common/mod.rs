#![allow(dead_code)]

use gfa_core::layout::{Layout, LayoutOptions};
use gfa_core::search::align::{GAP_EXTEND, GAP_OPEN, MATCH, MISMATCH};
use gfa_core::search::kmer::{IndexBuilder, KmerIndex};
use gfa_core::search::seed::{Part, Skipped, min_score, segment_hits};
use gfa_core::{
    FatalError, Graph, ParseOptions, Parser, Stats, WarningKind, bases_from_file,
    bases_from_packed, parse, reverse_complement,
};
use std::fmt::Write;

pub fn testdata(name: &str) -> Vec<u8> {
    let path = format!("{}/../../data/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

pub const FIXTURES: [&str; 14] = [
    "linear.gfa",
    "circle.gfa",
    "bubble.gfa",
    "tip.gfa",
    "tangle.gfa",
    "two_components.gfa",
    "self_loop.gfa",
    "palindrome.gfa",
    "star_ln.gfa",
    "mirror_links.gfa",
    "forward_refs.gfa",
    "paths.gfa",
    "bubble.fastg",
    "circle.fastg",
];

pub fn id(g: &Graph, name: &str) -> u32 {
    g.names.find(name.as_bytes()).unwrap()
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

pub fn indexed(sequences: &[Vec<u8>], k: usize) -> KmerIndex {
    let mut b = IndexBuilder::new(sequences.len(), k);
    for (i, s) in sequences.iter().enumerate() {
        b.add(i as u32, s).unwrap();
    }
    b.plan().unwrap();
    while !b.step(1 << 20).unwrap() {}
    b.finish()
}

pub fn sequences_of(g: &Graph, file: &[u8]) -> Vec<Vec<u8>> {
    (0..g.segments.len())
        .map(|i| {
            let s = &g.segments;
            let bases = if s.seq[i] == gfa_core::NO_SEQ {
                None
            } else if let Some(p) = &g.packed {
                bases_from_packed(p, s.seq[i], s.length[i], s.flags[i])
            } else {
                bases_from_file(&file[s.seq[i] as usize..], s.length[i], s.flags[i])
            };
            bases.unwrap_or_default().to_ascii_uppercase()
        })
        .collect()
}

pub fn point(p: &[f32], i: u32) -> (f32, f32) {
    (p[i as usize * 2], p[i as usize * 2 + 1])
}

pub fn brute_matrix(q: &[u8], t: &[u8]) -> Vec<Vec<i32>> {
    let open = GAP_OPEN + GAP_EXTEND;
    let mut h = vec![vec![0i32; t.len() + 1]; q.len() + 1];
    let mut f = vec![i32::MIN / 2; t.len() + 1];
    for (i, &a) in q.iter().enumerate() {
        let mut e = i32::MIN / 2;
        for (j, &b) in t.iter().enumerate() {
            let same = a == b && matches!(a, b'A' | b'C' | b'G' | b'T');
            e = (h[i + 1][j] - open).max(e - GAP_EXTEND);
            f[j + 1] = (h[i][j + 1] - open).max(f[j + 1] - GAP_EXTEND);
            h[i + 1][j + 1] = (h[i][j] + if same { MATCH } else { MISMATCH })
                .max(e)
                .max(f[j + 1])
                .max(0);
        }
    }
    h
}

/// The best local score over all alignments, and over those through an exact
/// k-mer: what seeding promises to reach. Scores from each end meet at the k-mer.
pub fn brute_scores(q: &[u8], t: &[u8], k: usize) -> (i32, i32) {
    let forward = brute_matrix(q, t);
    let backward_q: Vec<u8> = q.iter().rev().copied().collect();
    let backward_t: Vec<u8> = t.iter().rev().copied().collect();
    let backward = brute_matrix(&backward_q, &backward_t);
    let best = forward.iter().flatten().copied().max().unwrap_or(0);
    let mut seeded = 0;
    for (i, word) in q.windows(k).enumerate() {
        if !word.iter().all(|b| b"ACGT".contains(b)) {
            continue;
        }
        for (j, other) in t.windows(k).enumerate() {
            if word == other {
                let before = forward[i][j];
                let after = backward[q.len() - i - k][t.len() - j - k];
                seeded = seeded.max(before + MATCH * k as i32 + after);
            }
        }
    }
    (best, seeded)
}

/// Every strand's best alignment through a seed is reached, and nothing is
/// reported above the best alignment there is.
pub fn check_against_brute_force(index: &KmerIndex, sequences: &[Vec<u8>], query: &[u8]) {
    let parts = segment_hits(index, query, &mut Skipped::default());
    let threshold = min_score(query.len());
    for (segment, forward) in sequences.iter().enumerate() {
        let forward = forward.to_ascii_uppercase();
        for reverse in [false, true] {
            let target = if reverse {
                reverse_complement(&forward)
            } else {
                forward.clone()
            };
            let (brute, seeded) = brute_scores(query, &target, index.k());
            let found = parts
                .iter()
                .filter(|p: &&Part| p.segment == segment as u32 && p.reverse == reverse)
                .map(|p| p.score)
                .max()
                .unwrap_or(0);
            assert!(
                found <= brute,
                "segment {segment} reverse {reverse}: {found} above brute force {brute}"
            );
            if seeded >= threshold {
                assert!(
                    found >= seeded,
                    "segment {segment} reverse {reverse}: {found} below {seeded} of {:?}",
                    String::from_utf8_lossy(query)
                );
            }
        }
    }
}

pub type NamedLink = (String, char, String, char);

pub fn links(g: &Graph) -> Vec<NamedLink> {
    let name = |i: u32| String::from_utf8_lossy(g.names.get(i)).into_owned();
    let sign = |r: bool| if r { '-' } else { '+' };
    (0..g.links.len())
        .map(|i| {
            let l = &g.links;
            (
                name(l.from[i]),
                sign(l.from_reverse(i)),
                name(l.to[i]),
                sign(l.to_reverse(i)),
            )
        })
        .collect()
}

pub fn link(a: &str, ao: char, b: &str, bo: char) -> NamedLink {
    (a.into(), ao, b.into(), bo)
}

pub fn warnings(g: &Graph) -> Vec<(u64, WarningKind)> {
    g.warnings.list.iter().map(|w| (w.line, w.kind)).collect()
}

pub fn run(name: &str, options: LayoutOptions) -> (Layout, Vec<f32>) {
    let graph = load(name);
    let mut layout = Layout::new(graph.topology(), options).unwrap();
    while !layout.step(64) {}
    let mut positions = Vec::new();
    layout.write_positions(&mut positions);
    (layout, positions)
}
