mod common;

use common::{id, link, links, load, testdata, warnings};
use gfa_core::{
    DEFAULT_BUDGET, Format, NO_SEQ, ParseOptions, SeqMode, WarningKind, parse, seg_flags,
};

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

#[test]
fn labels_follow_bandage_order() {
    use gfa_core::analysis::labels::{LabelContent, label_lines, label_sizes};
    let g = load("colour_tags.gfa");
    let all = LabelContent {
        custom: true,
        name: true,
        length: true,
        depth: true,
    };
    assert_eq!(
        label_lines(&g, id(&g, "red"), all),
        ["first", "red", "4 bp"]
    );
    assert_eq!(
        label_lines(&g, id(&g, "bad"), all),
        ["back\\nside", "bad", "4 bp"]
    );
    let names = LabelContent {
        name: true,
        ..LabelContent::default()
    };
    let sizes = label_sizes(&g, names);
    let n = g.segments.len();
    let (red, blue) = (id(&g, "red") as usize, id(&g, "blue") as usize);
    assert_eq!(sizes[n + red], 3 | 1 << 16);
    assert_eq!(sizes[n + blue], 4 | 1 << 16);
    let mut ranks = sizes[..n].to_vec();
    ranks.sort_unstable();
    assert_eq!(ranks, (0..n as u32).collect::<Vec<_>>());
}
