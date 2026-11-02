//! Sequence search against brute force: a full Smith-Waterman of every query
//! over every strand of every segment.

mod common;

use gfa_core::search::align::{GAP_EXTEND, GAP_OPEN, MATCH, MISMATCH};
use gfa_core::search::kmer::{DEFAULT_K, IndexBuilder, KmerIndex};
use gfa_core::search::links::LinkTable;
use gfa_core::search::search;
use gfa_core::search::seed::{Part, Skipped, min_score, segment_hits};
use gfa_core::{Graph, bases_from_file, bases_from_packed, parse, reverse_complement};
use proptest::prelude::*;

/// For each cell of the full matrix, the best local score ending there.
fn brute_matrix(q: &[u8], t: &[u8]) -> Vec<Vec<i32>> {
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
fn brute_scores(q: &[u8], t: &[u8], k: usize) -> (i32, i32) {
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

fn indexed(sequences: &[Vec<u8>], k: usize) -> KmerIndex {
    let mut b = IndexBuilder::new(sequences.len(), k);
    for (i, s) in sequences.iter().enumerate() {
        b.add(i as u32, s).unwrap();
    }
    b.plan().unwrap();
    while !b.step(1 << 20).unwrap() {}
    b.finish()
}

/// Every strand's best alignment through a seed is reached, and nothing is
/// reported above the best alignment there is.
fn check_against_brute_force(index: &KmerIndex, sequences: &[Vec<u8>], query: &[u8]) {
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

fn sequences_of(g: &Graph, file: &[u8]) -> Vec<Vec<u8>> {
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

#[test]
fn matches_brute_force_on_every_small_graph() {
    let dir = format!("{}/../../testdata", env!("CARGO_MANIFEST_DIR"));
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

fn dna(range: std::ops::Range<usize>) -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(prop::sample::select(b"ACGT".to_vec()), range)
}

/// A query cut from a segment and mutated: substitutions, a short insertion
/// and a short deletion.
fn mutated(
    bases: &[u8],
    from: usize,
    length: usize,
    edits: &[(usize, u8)],
    reverse: bool,
) -> Vec<u8> {
    let from = from % bases.len();
    let to = (from + length).min(bases.len());
    let mut query = bases[from..to].to_vec();
    for &(at, base) in edits {
        if query.is_empty() {
            break;
        }
        let at = at % query.len();
        match base % 6 {
            4 => {
                query.insert(at, b"ACGT"[usize::from(base) % 4]);
            }
            5 => {
                query.remove(at);
            }
            _ => query[at] = b"ACGT"[usize::from(base) % 4],
        }
    }
    if reverse {
        reverse_complement(&query)
    } else {
        query
    }
}

struct Joined {
    index: KmerIndex,
    links: LinkTable,
    sequences: Vec<Vec<u8>>,
    graph: Graph,
}

fn joined() -> Joined {
    let file = common::testdata("search.gfa");
    let graph = parse(&file, Default::default()).unwrap();
    let sequences = sequences_of(&graph, &file);
    let index = indexed(&sequences, DEFAULT_K);
    let links = LinkTable::from_links(sequences.len(), &graph.links);
    Joined {
        index,
        links,
        sequences,
        graph,
    }
}

impl Joined {
    fn bases(&self, name: &str) -> &[u8] {
        &self.sequences[self.graph.names.find(name.as_bytes()).unwrap() as usize]
    }

    /// The name, strand and range of each part of each hit.
    fn hits(&self, query: &[u8]) -> Vec<Vec<(String, bool, u32, u32)>> {
        search(&self.index, &self.links, query)
            .hits
            .iter()
            .map(|hit| {
                hit.parts
                    .iter()
                    .map(|p| {
                        let name = self.graph.names.get(p.segment);
                        (
                            String::from_utf8_lossy(name).into_owned(),
                            p.reverse,
                            p.t_start,
                            p.t_end,
                        )
                    })
                    .collect()
            })
            .collect()
    }
}

fn part(name: &str, reverse: bool, from: u32, to: u32) -> (String, bool, u32, u32) {
    (name.to_owned(), reverse, from, to)
}

#[test]
fn an_overlapping_link_joins_and_counts_the_overlap_once() {
    let g = joined();
    let query = [g.bases("a"), &g.bases("b")[25..]].concat();
    assert_eq!(
        g.hits(&query),
        [[part("a", false, 0, 120), part("b", false, 0, 125)]]
    );
    let hit = &search(&g.index, &g.links, &query).hits[0];
    assert_eq!((hit.q_start, hit.q_end), (0, query.len() as u32));
    assert_eq!(
        (hit.matches, hit.columns),
        (query.len() as u32, query.len() as u32)
    );
}

#[test]
fn a_link_joins_on_the_strand_it_names_and_read_from_either_end() {
    let g = joined();
    let c = reverse_complement(g.bases("c"));
    let query = [g.bases("a"), &c].concat();
    let forward = vec![vec![part("a", false, 0, 120), part("c", true, 0, 90)]];
    assert_eq!(g.hits(&query)[..1], forward);
    let mirrored = vec![vec![part("c", false, 0, 90), part("a", true, 0, 120)]];
    assert_eq!(g.hits(&reverse_complement(&query))[..1], mirrored);
}

#[test]
fn parts_without_a_link_stay_apart() {
    let g = joined();
    // The last 25 bases of a are also the start of b, a hit of its own.
    let apart = vec![
        vec![part("a", false, 0, 120)],
        vec![part("d", false, 0, 80)],
        vec![part("b", false, 0, 25)],
    ];
    let query = [g.bases("a"), g.bases("d")].concat();
    assert_eq!(g.hits(&query), apart);
    let wrong_strand = [g.bases("a"), g.bases("c")].concat();
    assert_eq!(
        g.hits(&wrong_strand)[..2],
        [
            vec![part("a", false, 0, 120)],
            vec![part("c", false, 0, 90)]
        ]
    );
}

#[test]
fn a_walk_bridges_a_segment_too_short_to_seed_and_takes_the_base_that_matches() {
    let g = joined();
    for (name, base) in [("snpG", b"G"), ("snpA", b"A")] {
        let query = [g.bases("e"), base, g.bases("f")].concat();
        let hits = g.hits(&query);
        assert_eq!(
            hits,
            [[
                part("e", false, 0, 100),
                part(name, false, 0, 1),
                part("f", false, 0, 100)
            ]]
        );
        let hit = &search(&g.index, &g.links, &query).hits[0];
        assert_eq!(hit.matches, query.len() as u32);
        assert_eq!(hit.columns, query.len() as u32);
    }
}

#[test]
fn a_link_of_unknown_overlap_joins_whatever_the_query_shares() {
    let g = joined();
    let query = [g.bases("h"), g.bases("i")].concat();
    assert_eq!(
        g.hits(&query),
        [[part("h", false, 0, 90), part("i", false, 0, 70)]]
    );
}

/// As the Myxococcus sample writes them: `0M` over 40 bases the segments share.
#[test]
fn a_link_that_understates_its_overlap_still_joins() {
    let g = joined();
    let query = [g.bases("k1"), &g.bases("k2")[40..]].concat();
    assert_eq!(
        g.hits(&query),
        [[part("k1", false, 0, 90), part("k2", false, 0, 100)]]
    );
    let hit = &search(&g.index, &g.links, &query).hits[0];
    assert_eq!(hit.columns, query.len() as u32);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]

    /// A walk through a graph of random segments reads as one whole hit.
    #[test]
    fn a_walk_through_the_graph_reads_as_one_hit(
        sequences in prop::collection::vec(dna(25..120), 2..10),
        steps in prop::collection::vec((0usize..10, any::<bool>()), 2..6),
    ) {
        let walk: Vec<(usize, bool)> = {
            let mut used = vec![false; sequences.len()];
            steps.iter().filter_map(|&(s, r)| {
                let s = s % sequences.len();
                (!std::mem::replace(&mut used[s], true)).then_some((s, r))
            }).collect()
        };
        prop_assume!(walk.len() >= 2);
        let mut text = String::new();
        for (i, s) in sequences.iter().enumerate() {
            text += &format!("S\ts{i}\t{}\n", String::from_utf8_lossy(s));
        }
        let sign = |r: bool| if r { '-' } else { '+' };
        let mut query = Vec::new();
        for (k, &(s, r)) in walk.iter().enumerate() {
            let bases = &sequences[s];
            query.extend(if r { reverse_complement(bases) } else { bases.clone() });
            if let Some(&(t, tr)) = walk.get(k + 1) {
                text += &format!("L\ts{s}\t{}\ts{t}\t{}\t0M\n", sign(r), sign(tr));
            }
        }
        let graph = parse(text.as_bytes(), Default::default()).unwrap();
        let index = indexed(&sequences_of(&graph, text.as_bytes()), DEFAULT_K);
        let links = LinkTable::from_links(sequences.len(), &graph.links);
        let found = search(&index, &links, &query);
        let top = &found.hits[0];
        prop_assert_eq!((top.q_start, top.q_end), (0, query.len() as u32));
        prop_assert_eq!(top.matches, query.len() as u32);
        prop_assert_eq!(top.parts.len(), walk.len());
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]

    #[test]
    fn k_mer_search_finds_what_brute_force_finds(
        sequences in prop::collection::vec(dna(20..300), 1..8),
        pick in 0usize..8,
        from in 0usize..300,
        length in 20usize..300,
        edits in prop::collection::vec((0usize..300, any::<u8>()), 0..12),
        reverse in any::<bool>(),
    ) {
        let index = indexed(&sequences, DEFAULT_K);
        let query = mutated(&sequences[pick % sequences.len()], from, length, &edits, reverse);
        if query.len() >= DEFAULT_K {
            check_against_brute_force(&index, &sequences, &query);
        }
    }

    /// Whatever the bytes, links and overlaps, a search ends without a panic.
    #[test]
    fn any_input_is_searched_without_a_panic(
        sequences in prop::collection::vec(prop::collection::vec(any::<u8>(), 0..80), 1..6),
        repeat in prop::collection::vec(prop::sample::select(b"ACGTNacgt".to_vec()), 0..200),
        query in prop::collection::vec(prop::sample::select(b"ACGTNRx-acgt".to_vec()), 0..200),
        links in prop::collection::vec((0u32..8, 0u32..8, 0u8..64, 0u32..300, 0u32..300), 0..12),
        k in 0usize..24,
    ) {
        let mut sequences = sequences;
        sequences.push(repeat.clone());
        let mut b = IndexBuilder::new(sequences.len(), k);
        for (i, s) in sequences.iter().enumerate() {
            b.add(i as u32, s).unwrap();
        }
        b.plan().unwrap();
        while !b.step(64).unwrap() {}
        let index = b.finish();
        let table = LinkTable::new(
            sequences.len(),
            &links.iter().map(|l| l.0).collect::<Vec<_>>(),
            &links.iter().map(|l| l.1).collect::<Vec<_>>(),
            &links.iter().map(|l| l.2).collect::<Vec<_>>(),
            &links.iter().map(|l| l.3).collect::<Vec<_>>(),
            &links.iter().map(|l| l.4).collect::<Vec<_>>(),
        );
        let found = search(&index, &table, &[&repeat[..], &query[..], &repeat[..]].concat());
        for hit in found.hits {
            prop_assert!(hit.q_start <= hit.q_end);
            for part in hit.parts {
                let (start, end) = part.forward(index.length(part.segment));
                prop_assert!(start <= end && end <= index.length(part.segment));
            }
        }
    }

    /// Two letters make repeats, and so many seeds on many diagonals.
    #[test]
    fn repeats_do_not_lose_the_best_alignment(
        sequences in prop::collection::vec(prop::collection::vec(prop::sample::select(b"AC".to_vec()), 20..150), 1..4),
        query in prop::collection::vec(prop::sample::select(b"AC".to_vec()), 20..120),
    ) {
        check_against_brute_force(&indexed(&sequences, DEFAULT_K), &sequences, &query);
    }
}

#[test]
fn a_query_with_two_separate_matches_finds_both() {
    let unique_a = b"GATTACAGGCCTTAAGGCATCGATCGGATCCTTAGGCCAATTCGCGAATT";
    let unique_b = b"TTGACCAGTACGGTAACCGTTAGCATGCAAGCTTGGCACTGGCCGTCGTT";
    let spacer = [b'A'; 200];
    let segment = [&unique_a[..], &spacer, &unique_b[..]].concat();
    let index = indexed(std::slice::from_ref(&segment), DEFAULT_K);
    let query = [&unique_b[..], &unique_a[..]].concat();
    let parts = segment_hits(&index, &query, &mut Skipped::default());
    assert!(
        parts
            .iter()
            .any(|p| p.q_start == 0 && p.q_end == 50 && p.t_start == 250 && p.t_end == 300),
        "{parts:?}"
    );
    assert!(
        parts
            .iter()
            .any(|p| p.q_start == 50 && p.q_end == 100 && p.t_start == 0 && p.t_end == 50),
        "{parts:?}"
    );
}
