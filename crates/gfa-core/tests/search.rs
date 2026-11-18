//! Sequence search against brute force: a full Smith-Waterman of every query
//! over every strand of every segment.

mod common;

use common::{check_against_brute_force, indexed, sequences_of};

use gfa_core::search::kmer::DEFAULT_K;
use gfa_core::{parse, reverse_complement};

/// For each cell of the full matrix, the best local score ending there.
#[test]
fn matches_brute_force_on_every_small_graph() {
    let dir = format!("{}/../../data/fixtures", env!("CARGO_MANIFEST_DIR"));
    let mut graphs = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        let plain = name.ends_with(".gfa") || name.ends_with(".fastg");
        if !plain || name == "gfa2.gfa" {
            continue;
        }
        let Ok(g) = parse(&common::testdata(&name), Default::default()) else {
            continue;
        };
        graphs += 1;
        let file = common::testdata(&name);
        let sequences = sequences_of(&g, &file);
        for k in [8, DEFAULT_K] {
            let index = indexed(&sequences, k);
            for s in &sequences {
                if s.len() >= k {
                    check_against_brute_force(&index, &sequences, s);
                    check_against_brute_force(&index, &sequences, &reverse_complement(s));
                }
            }
            let spelled = sequences.concat();
            if spelled.len() >= k {
                check_against_brute_force(&index, &sequences, &spelled);
            }
        }
    }
    assert!(graphs >= 10, "only {graphs} graphs");
}
