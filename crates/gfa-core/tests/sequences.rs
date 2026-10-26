use gfa_core::{
    DEFAULT_BUDGET, Graph, ParseOptions, SeqMode, bases_from_file, bases_from_packed, parse,
    reverse_complement,
};
use proptest::prelude::*;

/// Letters Bandage's reverse complement maps one to one, so a reverse record can
/// be written for any forward sequence.
const ALPHABET: &[u8] = b"ACGTacgtNnRYSWKMBDHVrysw";

#[derive(Debug, Clone)]
struct Segment {
    bases: Vec<u8>,
    /// FASTG only: the segment is written as its reverse record alone.
    reverse_only: bool,
}

fn segments() -> impl Strategy<Value = Vec<Segment>> {
    prop::collection::vec(
        (
            prop::collection::vec(prop::sample::select(ALPHABET), 1..300),
            any::<bool>(),
        )
            .prop_map(|(bases, reverse_only)| Segment {
                bases,
                reverse_only,
            }),
        1..20,
    )
}

fn gfa(segments: &[Segment]) -> Vec<u8> {
    let mut out = b"H\tVN:Z:1.0\n".to_vec();
    for (i, s) in segments.iter().enumerate() {
        out.extend_from_slice(format!("S\ts{i}\t").as_bytes());
        out.extend_from_slice(&s.bases);
        out.extend_from_slice(b"\tDP:f:2\n");
    }
    out
}

fn fastg(segments: &[Segment], width: usize, crlf: bool) -> Vec<u8> {
    let newline: &[u8] = if crlf { b"\r\n" } else { b"\n" };
    let mut out = Vec::new();
    for (i, s) in segments.iter().enumerate() {
        let (mark, bases) = if s.reverse_only {
            ("'", reverse_complement(&s.bases))
        } else {
            ("", s.bases.clone())
        };
        out.extend_from_slice(
            format!(">EDGE_{}_length_{}_cov_1.5{mark};", i + 1, bases.len()).as_bytes(),
        );
        out.extend_from_slice(newline);
        for line in bases.chunks(width) {
            out.extend_from_slice(line);
            out.extend_from_slice(newline);
        }
    }
    out
}

fn retrieved(g: &Graph, file: &[u8], id: usize) -> Option<Vec<u8>> {
    let s = &g.segments;
    match &g.packed {
        Some(packed) => bases_from_packed(packed, s.seq[id], s.length[id], s.flags[id]),
        None => bases_from_file(file.get(s.seq[id] as usize..)?, s.length[id], s.flags[id]),
    }
}

fn check(
    file: &[u8],
    segments: &[Segment],
    id_of: impl Fn(usize) -> String,
) -> Result<(), TestCaseError> {
    for seq_mode in [
        SeqMode::FileOffsets,
        SeqMode::Packed {
            budget_bytes: DEFAULT_BUDGET,
        },
    ] {
        let g = parse(file, ParseOptions { seq_mode }).unwrap();
        for (i, s) in segments.iter().enumerate() {
            let id = g.names.find(id_of(i).as_bytes()).unwrap() as usize;
            prop_assert_eq!(
                retrieved(&g, file, id),
                Some(s.bases.clone()),
                "segment {} in {:?}",
                i,
                seq_mode
            );
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn gfa_sequences_come_back_as_written(segments in segments()) {
        check(&gfa(&segments), &segments, |i| format!("s{i}"))?;
    }

    #[test]
    fn fastg_sequences_come_back_forward(segments in segments(), width in 1usize..90, crlf in any::<bool>()) {
        check(&fastg(&segments, width, crlf), &segments, |i| format!("{}", i + 1))?;
    }
}
