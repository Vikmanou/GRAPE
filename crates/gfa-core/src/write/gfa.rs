//! GFA as Bandage's "Save entire graph to GFA" writes it
//! (`saveEntireGraphToGfa` in graph/assemblygraph.cpp, `getGfaSegmentLine`
//! in graph/debruijnnode.cpp, `getGfaLinkLine`, `isPositiveEdge` and
//! `compareEdgePointers` in graph/debruijnedge.cpp,
//! <https://github.com/rrwick/Bandage>). Segments come in the order of
//! Bandage's node map; each link is written once, as its positive edge.
//! Unlike Bandage, a segment without a sequence keeps its real `LN`.

use crate::store::graph::{DepthTag, Graph};
use crate::store::link_bits;
use crate::write::colour_names::BANDAGE_COLOUR_NAMES;
use crate::write::fasta::{DEFAULT_DEPTH, format_g};
use std::cmp::Ordering;

/// Segments in the order Bandage writes them.
pub fn segment_order(g: &Graph) -> Vec<u32> {
    let mut ids: Vec<u32> = (0..g.segments.len() as u32)
        .filter(|&s| g.segments.is_defined(s))
        .collect();
    ids.sort_by(|&a, &b| signed(g.names.get(a), false).cmp(signed(g.names.get(b), false)));
    ids
}

fn signed(name: &[u8], reverse: bool) -> impl Iterator<Item = &u8> + Clone {
    name.iter().chain(if reverse { b"-" } else { b"+" })
}

/// One `S` line. `sequence` is `None` when the file gave `*`.
pub fn write_segment(
    out: &mut Vec<u8>,
    name: &[u8],
    length: u32,
    sequence: Option<&[u8]>,
    tag: DepthTag,
    depth: f32,
    custom: &[u8],
) {
    out.extend_from_slice(b"S\t");
    out.extend_from_slice(name);
    out.push(b'\t');
    out.extend_from_slice(sequence.unwrap_or(b"*"));
    let length = sequence.map_or(u64::from(length), |s| s.len() as u64);
    out.extend_from_slice(format!("\tLN:i:{length}").as_bytes());
    let depth = if depth.is_nan() {
        DEFAULT_DEPTH
    } else {
        f64::from(depth)
    };
    let count = || ((depth * length as f64 + 0.5) as i64).to_string();
    let field = match tag {
        DepthTag::None => None,
        DepthTag::Dp => Some(format!("\tDP:f:{}", format_g(depth))),
        DepthTag::Kc => Some(format!("\tKC:i:{}", count())),
        DepthTag::Rc => Some(format!("\tRC:i:{}", count())),
        DepthTag::Fc => Some(format!("\tFC:i:{}", count())),
    };
    if let Some(field) = field {
        out.extend_from_slice(field.as_bytes());
    }
    out.extend_from_slice(custom);
    out.push(b'\n');
}

/// The LB, L2, CL and C2 fields a segment's line ends with, Bandage's `z` included.
pub fn custom_fields(g: &Graph, segment: u32) -> Vec<u8> {
    let find = |list: &[(u32, u32)]| {
        list.binary_search_by_key(&segment, |e| e.0)
            .ok()
            .map(|i| list[i].1)
    };
    let label = |list: &[(u32, String)]| {
        list.binary_search_by_key(&segment, |e| e.0)
            .ok()
            .map(|i| list[i].1.clone())
    };
    let c = &g.custom;
    let mut out = String::new();
    if let Some(l) = label(&c.label) {
        out += &format!("\tLB:z:{l}");
    }
    if let Some(l) = label(&c.label2) {
        out += &format!("\tL2:z:{l}");
    }
    if let Some(color) = find(&c.color) {
        out += &format!("\tCL:z:{}", colour_name(color));
    }
    if let Some(color) = find(&c.color2) {
        out += &format!("\tC2:z:{}", colour_name(color));
    }
    out.into_bytes()
}

/// Bandage's `getColourName`: an SVG name for an opaque colour in its list,
/// else Qt's `QColor::name()`, `#rrggbb`.
fn colour_name(rgba: u32) -> String {
    let [r, g, b, a] = rgba.to_le_bytes();
    let named = (a == 255)
        .then(|| {
            BANDAGE_COLOUR_NAMES
                .iter()
                .find(|(rgb, _)| *rgb == [r, g, b])
        })
        .flatten();
    named.map_or_else(
        || format!("#{r:02x}{g:02x}{b:02x}"),
        |(_, name)| (*name).to_owned(),
    )
}

/// An edge as Bandage holds it: start and end segments with their signs.
#[derive(Clone, Copy)]
struct Edge {
    from: u32,
    from_reverse: bool,
    to: u32,
    to_reverse: bool,
    overlap: u32,
}

/// Of a link's two edges, the one `isPositiveEdge` keeps.
fn positive_edge(g: &Graph, l: usize) -> Edge {
    let links = &g.links;
    let bits = links.bits[l];
    // Bandage keeps the overlap of the first line, measured on its From segment.
    let overlap = if bits & link_bits::OVERLAP_UNKNOWN != 0 {
        0
    } else if bits & link_bits::WRITTEN_MIRRORED != 0 {
        links.overlap_to[l]
    } else {
        links.overlap_from[l]
    };
    let given = Edge {
        from: links.from[l],
        from_reverse: links.from_reverse(l),
        to: links.to[l],
        to_reverse: links.to_reverse(l),
        overlap,
    };
    let mirror = Edge {
        from: given.to,
        from_reverse: !given.to_reverse,
        to: given.from,
        to_reverse: !given.from_reverse,
        overlap,
    };
    let own_mirror = given.from == mirror.from && given.from_reverse == mirror.from_reverse;
    let positive = match (given.from_reverse, given.to_reverse) {
        (false, false) => true,
        (true, true) => false,
        _ if own_mirror => true,
        _ => {
            let name = |e: &Edge| signed(g.names.get(e.from), e.from_reverse);
            name(&given).cmp(name(&mirror)) == Ordering::Greater
        }
    };
    if positive { given } else { mirror }
}

fn integer(name: &[u8]) -> Option<i64> {
    std::str::from_utf8(name).ok()?.trim_ascii().parse().ok()
}

/// `compareEdgePointers`: numerically by start then end when every name is
/// an integer, else by the start's name with its sign; ties, which Bandage
/// leaves to its sort, by the end's name with its sign.
fn edge_order(g: &Graph, a: &Edge, b: &Edge) -> Ordering {
    let name = |s: u32| g.names.get(s);
    let numbers = (
        integer(name(a.from)),
        integer(name(b.from)),
        integer(name(a.to)),
        integer(name(b.to)),
    );
    if let (Some(af), Some(bf), Some(at), Some(bt)) = numbers {
        let by_number = af.cmp(&bf).then(at.cmp(&bt));
        if by_number != Ordering::Equal {
            return by_number;
        }
    } else {
        let by_start =
            signed(name(a.from), a.from_reverse).cmp(signed(name(b.from), b.from_reverse));
        if by_start != Ordering::Equal {
            return by_start;
        }
    }
    signed(name(a.from), a.from_reverse)
        .cmp(signed(name(b.from), b.from_reverse))
        .then_with(|| signed(name(a.to), a.to_reverse).cmp(signed(name(b.to), b.to_reverse)))
}

/// Every `L` line, in Bandage's order.
pub fn write_links(out: &mut Vec<u8>, g: &Graph) {
    let mut edges: Vec<Edge> = (0..g.links.len())
        .filter(|&l| g.segments.is_defined(g.links.from[l]) && g.segments.is_defined(g.links.to[l]))
        .map(|l| positive_edge(g, l))
        .collect();
    edges.sort_by(|a, b| edge_order(g, a, b));
    let sign = |r: bool| if r { b'-' } else { b'+' };
    for e in edges {
        out.extend_from_slice(b"L\t");
        out.extend_from_slice(g.names.get(e.from));
        out.extend_from_slice(&[b'\t', sign(e.from_reverse), b'\t']);
        out.extend_from_slice(g.names.get(e.to));
        out.extend_from_slice(&[b'\t', sign(e.to_reverse), b'\t']);
        out.extend_from_slice(format!("{}M\n", e.overlap).as_bytes());
    }
}

/// The whole file, with each segment's forward bases from `bases`.
pub fn write_gfa(g: &Graph, bases: impl Fn(u32) -> Option<Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    for s in segment_order(g) {
        let i = s as usize;
        let sequence = bases(s);
        let custom = custom_fields(g, s);
        let (length, depth) = (g.segments.length[i], g.segments.depth[i]);
        write_segment(
            &mut out,
            g.names.get(s),
            length,
            sequence.as_deref(),
            g.depth_tag,
            depth,
            &custom,
        );
    }
    write_links(&mut out, g);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParseOptions, parse};

    fn written(gfa: &str, sequences: &[(&str, &str)]) -> String {
        let g = parse(gfa.as_bytes(), ParseOptions::default()).unwrap();
        let out = write_gfa(&g, |s| {
            let name = std::str::from_utf8(g.names.get(s)).unwrap();
            sequences
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, seq)| seq.as_bytes().to_vec())
        });
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn writes_what_bandage_saves() {
        let gfa = "S\t2\tACG\tDP:f:3.5\tCL:Z:#123456\n\
                   S\t10\tTT\tDP:f:2\tCL:Z:red\tLB:Z:hi\n\
                   S\t3\t*\tLN:i:5\n\
                   L\t10\t+\t2\t-\t1M\n\
                   L\t3\t-\t2\t-\t0M\n\
                   L\t2\t+\t2\t+\t0M\n";
        let expected = "S\t10\tTT\tLN:i:2\tDP:f:2\tLB:z:hi\tCL:z:red\n\
                        S\t2\tACG\tLN:i:3\tDP:f:3.5\tCL:z:#123456\n\
                        S\t3\t*\tLN:i:5\tDP:f:1\n\
                        L\t2\t+\t2\t+\t0M\n\
                        L\t2\t+\t3\t+\t0M\n\
                        L\t2\t+\t10\t-\t1M\n";
        assert_eq!(written(gfa, &[("2", "ACG"), ("10", "TT")]), expected);
    }

    #[test]
    fn counts_and_names_follow_the_depth_tag_and_string_order() {
        let gfa = "S\tb\tACGT\tKC:i:10\nS\ta\tAC\nL\tb\t+\ta\t-\t0M\nL\ta\t-\ta\t+\t0M\n";
        // b+ a- is mixed: Bandage keeps the edge whose start name is greater, "b+" over "a+".
        let expected = "S\ta\tAC\tLN:i:2\tKC:i:2\n\
                        S\tb\tACGT\tLN:i:4\tKC:i:10\n\
                        L\ta\t-\ta\t+\t0M\n\
                        L\tb\t+\ta\t-\t0M\n";
        assert_eq!(written(gfa, &[("a", "AC"), ("b", "ACGT")]), expected);
    }
}
