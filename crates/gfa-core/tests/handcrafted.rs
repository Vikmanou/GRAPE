mod common;

use common::{load, testdata};
use gfa_core::csr::end;
use gfa_core::{
    DEFAULT_BUDGET, FatalError, Format, Graph, NO_SEQ, ParseOptions, PathKind, REVERSE, SeqMode,
    Severity, WarningKind, parse, seg_flags,
};

fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

fn id(g: &Graph, name: &str) -> u32 {
    g.names.find(name.as_bytes()).unwrap()
}

type NamedLink = (String, char, String, char);

fn links(g: &Graph) -> Vec<NamedLink> {
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

fn link(a: &str, ao: char, b: &str, bo: char) -> NamedLink {
    (a.into(), ao, b.into(), bo)
}

fn warnings(g: &Graph) -> Vec<(u64, WarningKind)> {
    g.warnings.list.iter().map(|w| (w.line, w.kind)).collect()
}

#[test]
fn linear_chain() {
    let g = load("linear.gfa");
    let s = g.stats;
    assert_eq!((s.segments, s.links, s.total_length), (3, 2, 30));
    assert_eq!((s.n50, s.n75, s.longest, s.shortest), (10, 8, 12, 8));
    assert_eq!((s.components, s.dead_ends, s.isolated), (1, 2, 0));
    // dp:f:10, DP:f:20, and KC:i:120 over 12 bases.
    assert_eq!(g.segments.depth, [10.0, 20.0, 10.0]);
    assert!(approx(
        s.mean_depth,
        (10.0 * 10.0 + 8.0 * 20.0 + 12.0 * 10.0) / 30.0
    ));
    assert!(approx(f64::from(g.segments.gc[0]), 0.5));
    assert_eq!(g.version.as_deref(), Some("1.0"));
    assert_eq!(g.format, Format::Gfa);
    assert_eq!(g.warnings.total, 0);
}

#[test]
fn single_circle_has_no_dead_ends() {
    let s = load("circle.gfa").stats;
    assert_eq!(
        (s.segments, s.links, s.components, s.dead_ends),
        (3, 3, 1, 0)
    );
}

#[test]
fn bubble() {
    let g = load("bubble.gfa");
    assert_eq!((g.stats.links, g.stats.dead_ends), (4, 2));
    assert_eq!(g.adjacency.degree(end(0, true)), 2);
}

#[test]
fn tip() {
    let s = load("tip.gfa").stats;
    assert_eq!((s.dead_ends, s.shortest), (3, 3));
}

#[test]
fn tangle_with_three_entries_and_exits() {
    let g = load("tangle.gfa");
    let r = id(&g, "r");
    assert_eq!(g.adjacency.degree(end(r, false)), 3);
    assert_eq!(g.adjacency.degree(end(r, true)), 3);
    assert_eq!((g.stats.dead_ends, g.stats.components), (6, 1));
}

#[test]
fn two_components_ranked_by_length() {
    let g = load("two_components.gfa");
    assert_eq!(g.components.length, [20, 10]);
    assert_eq!(g.components.segments, [2, 2]);
    assert_eq!(g.segments.component, [0, 0, 1, 1]);
    let s = g.stats;
    assert_eq!(
        (s.largest_component_length, s.largest_component_segments),
        (20, 2)
    );
}

#[test]
fn self_loop() {
    let g = load("self_loop.gfa");
    assert_eq!(links(&g), [link("1", '+', "1", '+')]);
    assert_eq!((g.stats.dead_ends, g.stats.isolated), (0, 0));
}

#[test]
fn palindromic_link_joins_one_end_to_itself() {
    let g = load("palindrome.gfa");
    assert_eq!(links(&g), [link("a", '+', "a", '-')]);
    assert_eq!(g.adjacency.degree(end(0, true)), 1);
    assert_eq!(g.stats.dead_ends, 1);
}

#[test]
fn star_sequence_uses_ln() {
    let g = load("star_ln.gfa");
    assert_eq!(g.segments.length, [5000, 100, 0]);
    assert!(g.segments.gc.iter().all(|gc| gc.is_nan()));
    assert!(g.segments.flags.iter().all(|f| f & seg_flags::HAS_SEQ == 0));
    assert_eq!(g.segments.depth[0], 3.0);
    assert!(g.segments.depth[1].is_nan());
    assert_eq!(warnings(&g), [(4, WarningKind::MissingLength)]);
}

#[test]
fn mirror_links_are_deduplicated() {
    let g = load("mirror_links.gfa");
    assert_eq!(
        links(&g),
        [
            link("1", '+', "2", '+'),
            link("2", '+', "3", '-'),
            link("1", '+', "3", '+')
        ]
    );
    // Line 8 is the mirror of line 7 with its own overlap (per strand);
    // line 9 has an insertion, so its sides differ.
    assert_eq!(g.links.overlap_from, [5, 5, 5]);
    assert_eq!(g.links.overlap_to, [5, 4, 6]);
    assert_eq!(
        (g.counts.duplicate_links, g.counts.per_strand_overlaps),
        (1, 1)
    );
    assert_eq!(
        warnings(&g),
        [
            (9, WarningKind::ComplexOverlap),
            (10, WarningKind::OverlapConflict)
        ]
    );
}

#[test]
fn forward_references_resolve_and_undefined_ones_are_errors() {
    let g = load("forward_refs.gfa");
    assert_eq!((g.stats.segments, g.stats.undefined), (3, 1));
    assert_eq!(g.segments.length[id(&g, "1") as usize], 5);
    assert_eq!(
        g.paths.steps(0),
        [id(&g, "1"), id(&g, "2"), id(&g, "3") | REVERSE]
    );
    assert_eq!(warnings(&g), [(7, WarningKind::UndefinedSegment)]);
    assert_eq!(g.warnings.list[0].severity, Severity::Error);
    assert!(g.warnings.list[0].message.contains("'9'"));
}

#[test]
fn every_record_type() {
    let g = load("paths.gfa");
    assert_eq!(g.version.as_deref(), Some("1.1"));
    assert_eq!(
        (g.paths.count(PathKind::Path), g.paths.count(PathKind::Walk)),
        (1, 2)
    );
    let name = |i: u32| String::from_utf8_lossy(g.paths.names.get(i)).into_owned();
    assert_eq!(
        [name(0), name(1), name(2)],
        ["p1", "NA12878#1#chr1:0-11", "NA12878#2#chr1"]
    );
    let (a, b, c) = (id(&g, "s11"), id(&g, "s12"), id(&g, "s13"));
    assert_eq!(g.paths.steps(1), [a, b | REVERSE, c]);
    assert_eq!(g.paths.steps(2), [a, c]);
    assert_eq!(g.counts.containments, 1);
    assert_eq!(warnings(&g), [(13, WarningKind::UnknownRecord)]);
}

#[test]
fn malformed_lines_become_warnings() {
    use WarningKind::*;
    let g = load("malformed.gfa");
    assert_eq!(
        warnings(&g),
        [
            (2, MalformedTag),
            (3, Malformed),
            (4, MalformedTag),
            (5, LengthMismatch),
            (6, Malformed),
            (7, Malformed),
            (8, Malformed),
            (9, UnknownRecord),
            (11, DuplicateSegment),
            (14, Malformed),
            (15, Malformed),
            (16, Malformed),
            (17, MalformedTag),
        ]
    );
    assert!(g.warnings.list[7].message.contains("2 line(s)"));
    assert_eq!(g.stats.segments, 4);
    assert_eq!(links(&g), [link("1", '+', "3", '+')]);
    assert!(g.paths.is_empty());
}

#[test]
fn gfa2_is_rejected() {
    let o = ParseOptions::default();
    assert_eq!(
        parse(&testdata("gfa2.gfa"), o).unwrap_err(),
        FatalError::Gfa2 { line: 1 }
    );
    let edge = b"S\t1\tACGT\nE\t*\t1+\t1-\t0\t1\t0\t1\t*\n";
    assert_eq!(parse(edge, o).unwrap_err(), FatalError::Gfa2 { line: 2 });
}

#[test]
fn fatal_errors() {
    let o = ParseOptions::default();
    assert_eq!(parse(b"", o).unwrap_err(), FatalError::NoSegments);
    assert_eq!(
        parse(b"H\tVN:Z:1.0\nL\t1\t+\t2\t+\t0M\n", o).unwrap_err(),
        FatalError::NoSegments
    );
    assert_eq!(
        parse(b"S\t1\tAC\0GT\n", o).unwrap_err(),
        FatalError::NotText
    );
}

#[test]
fn crlf_and_unterminated_last_line() {
    let g = parse(
        b"S\t1\tACGT\r\nS\t2\tGG\r\nL\t1\t+\t2\t+\t0M",
        ParseOptions::default(),
    )
    .unwrap();
    assert_eq!(g.segments.length, [4, 2]);
    assert_eq!(g.stats.links, 1);
}

#[test]
fn plain_sequences_are_file_offsets() {
    let bytes = testdata("linear.gfa");
    let g = load("linear.gfa");
    let at = |i: usize| &bytes[g.segments.seq[i] as usize..][..g.segments.length[i] as usize];
    assert_eq!(
        [at(0), at(1), at(2)],
        [&b"ACGTACGTAC"[..], b"GGGCCCAA", b"TTTTAAAACCCC"]
    );
}

#[test]
fn packed_sequences_decode() {
    let packed = |budget_bytes| ParseOptions {
        seq_mode: SeqMode::Packed { budget_bytes },
    };
    let g = parse(&testdata("linear.gfa"), packed(DEFAULT_BUDGET)).unwrap();
    assert_eq!(
        g.packed.as_ref().unwrap().decode(g.segments.seq[2], 12),
        b"TTTTAAAACCCC"
    );

    let g = parse(&testdata("linear.gfa"), packed(3)).unwrap();
    assert!(g.packed.as_ref().unwrap().dropped);
    assert!(g.segments.seq.iter().all(|&s| s == NO_SEQ));
    assert_eq!(g.warnings.count(WarningKind::SequencesDropped), 1);
}

#[test]
fn fastg_matches_the_same_graph_in_gfa() {
    let (fastg, gfa) = (load("bubble.fastg"), load("bubble.gfa"));
    assert_eq!(fastg.format, Format::Fastg);
    assert_eq!(fastg.warnings.total, 0);
    assert_eq!(links(&fastg), links(&gfa));
    assert_eq!(fastg.links.bits, gfa.links.bits);
    assert_eq!(fastg.segments.length, gfa.segments.length);
    assert_eq!(fastg.segments.depth, gfa.segments.depth);
    assert_eq!(fastg.segments.gc, gfa.segments.gc);
    assert_eq!(fastg.segments.component, gfa.segments.component);
    assert_eq!(fastg.counts.duplicate_links, 4);
    let (f, g) = (fastg.stats, gfa.stats);
    assert_eq!(
        (f.n50, f.dead_ends, f.total_length),
        (g.n50, g.dead_ends, g.total_length)
    );
}

#[test]
fn fastg_wrapped_sequence_offset() {
    let bytes = testdata("circle.fastg");
    let g = load("circle.fastg");
    assert_eq!(g.segments.length, [12, 6]);
    assert_eq!(g.segments.depth, [8.5, 8.5]);
    assert_ne!(g.segments.flags[0] & seg_flags::SEQ_WRAPPED, 0);
    assert_eq!(&bytes[g.segments.seq[0] as usize..][..6], b"ACGTAC");
    assert_eq!((g.stats.links, g.stats.dead_ends), (2, 0));
}

#[test]
fn fastg_reverse_only_record_defines_the_segment() {
    let g = load("reverse_only.fastg");
    let two = id(&g, "2") as usize;
    assert_eq!(g.stats.segments, 2);
    assert_ne!(g.segments.flags[two] & seg_flags::SEQ_REVERSED, 0);
    assert_eq!((g.segments.length[two], g.segments.depth[two]), (4, 3.0));
    assert_eq!(links(&g), [link("1", '+', "2", '+')]);
    assert_eq!(g.warnings.total, 0);
}

#[test]
fn fastg_malformed() {
    let g = load("malformed.fastg");
    let lines: Vec<u64> = g.warnings.list.iter().map(|w| w.line).collect();
    assert_eq!(lines, [1, 3, 4, 6]);
    assert_eq!(g.stats.segments, 1);
    assert_eq!(g.segments.length, [2]);
}

fn line_at(bytes: &[u8], offset: u64) -> &[u8] {
    let rest = &bytes[offset as usize..];
    &rest[..rest.iter().position(|&b| b == b'\n').unwrap_or(rest.len())]
}

#[test]
fn segment_lines_point_at_their_records() {
    let bytes = testdata("star_ln.gfa");
    let g = parse(&bytes, ParseOptions::default()).unwrap();
    for i in 0..g.segments.len() as u32 {
        let name = g.names.get(i);
        let line = line_at(&bytes, g.segments.line[i as usize]);
        assert!(
            line.starts_with(&[b"S\t", name, b"\t"].concat()),
            "{line:?}"
        );
    }

    let bytes = testdata("reverse_only.fastg");
    let g = parse(&bytes, ParseOptions::default()).unwrap();
    for i in 0..g.segments.len() as u32 {
        let name = g.names.get(i);
        let line = line_at(&bytes, g.segments.line[i as usize]);
        assert!(
            line.starts_with(&[b">EDGE_", name, b"_"].concat()),
            "{line:?}"
        );
    }
}

#[test]
fn packed_input_keeps_no_line_offsets() {
    let options = ParseOptions {
        seq_mode: SeqMode::Packed {
            budget_bytes: DEFAULT_BUDGET,
        },
    };
    let g = parse(&testdata("linear.gfa"), options).unwrap();
    assert!(g.segments.line.is_empty());
}

#[test]
fn custom_colours_and_labels() {
    let g = load("colour_tags.gfa");
    let (red, blue, bad) = (id(&g, "red"), id(&g, "blue"), id(&g, "bad"));
    let c = &g.custom;
    assert_eq!(c.color, [(red, 0xff00_00ff), (blue, 0xffff_0000)]);
    assert_eq!(c.color2, [(blue, 0x8000_ff00)]);
    assert_eq!(c.label, [(red, "first".to_owned())]);
    assert_eq!(c.label2, [(bad, "back\\nside".to_owned())]);
    assert_eq!(warnings(&g), [(5, WarningKind::MalformedTag)]);
}
