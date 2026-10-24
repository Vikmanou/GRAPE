mod common;

use common::{parse_chunked, snapshot, testdata};
use gfa_core::{DEFAULT_BUDGET, ParseOptions, SeqMode, parse};
use proptest::prelude::*;

const FILES: &[&str] = &[
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
    "malformed.gfa",
    "bubble.fastg",
    "circle.fastg",
    "reverse_only.fastg",
    "malformed.fastg",
];

const MODES: [SeqMode; 2] = [
    SeqMode::FileOffsets,
    SeqMode::Packed {
        budget_bytes: DEFAULT_BUDGET,
    },
];

fn whole(bytes: &[u8], seq_mode: SeqMode) -> String {
    snapshot(&parse(bytes, ParseOptions { seq_mode }).unwrap())
}

fn crlf(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .flat_map(|&b| {
            if b == b'\n' {
                vec![b'\r', b'\n']
            } else {
                vec![b]
            }
        })
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn chunk_boundaries_never_change_the_result(mut cuts in prop::collection::vec(0usize..600, 0..40)) {
        cuts.sort_unstable();
        for name in FILES {
            for bytes in [testdata(name), crlf(&testdata(name))] {
                for seq_mode in MODES {
                    let chunked = parse_chunked(&bytes, &cuts, ParseOptions { seq_mode }).unwrap();
                    prop_assert_eq!(snapshot(&chunked), whole(&bytes, seq_mode), "{}", name);
                }
            }
        }
    }

    #[test]
    fn byte_at_a_time_matches(index in 0..FILES.len()) {
        let bytes = testdata(FILES[index]);
        let cuts: Vec<usize> = (1..bytes.len()).collect();
        let chunked = parse_chunked(&bytes, &cuts, ParseOptions::default()).unwrap();
        prop_assert_eq!(snapshot(&chunked), whole(&bytes, SeqMode::FileOffsets));
    }

    #[test]
    fn arbitrary_bytes_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..2000), mut cuts in prop::collection::vec(0usize..2000, 0..8)) {
        cuts.sort_unstable();
        let _ = parse_chunked(&bytes, &cuts, ParseOptions::default());
    }

    #[test]
    fn stats_match_a_naive_reference(graph in small_graph()) {
        let g = parse(graph.gfa().as_bytes(), ParseOptions::default()).unwrap();
        let naive = graph.naive();
        let s = g.stats;
        prop_assert_eq!(s.segments, graph.lengths.len() as u64);
        prop_assert_eq!(s.total_length, naive.total);
        prop_assert_eq!((s.n50, s.n75), (naive.n50, naive.n75));
        prop_assert_eq!(s.dead_ends, naive.dead_ends);
        prop_assert_eq!(s.isolated, naive.isolated);
        prop_assert_eq!(s.components, naive.components.len() as u64);
        prop_assert_eq!(&g.components.length, &naive.components);
        prop_assert_eq!(s.links, naive.links);
        prop_assert!((s.mean_depth - naive.mean_depth).abs() < 1e-3);
    }
}

#[derive(Debug, Clone)]
struct SmallGraph {
    lengths: Vec<u32>,
    depths: Vec<u32>,
    links: Vec<(usize, bool, usize, bool)>,
}

struct Naive {
    total: u64,
    n50: u32,
    n75: u32,
    dead_ends: u64,
    isolated: u64,
    components: Vec<u64>,
    links: u64,
    mean_depth: f64,
}

fn small_graph() -> impl Strategy<Value = SmallGraph> {
    (1usize..25).prop_flat_map(|n| {
        (
            prop::collection::vec(1u32..60, n),
            prop::collection::vec(1u32..50, n),
            prop::collection::vec((0..n, any::<bool>(), 0..n, any::<bool>()), 0..n * 2),
        )
            .prop_map(|(lengths, depths, links)| SmallGraph {
                lengths,
                depths,
                links,
            })
    })
}

impl SmallGraph {
    fn gfa(&self) -> String {
        let mut text = String::new();
        for (i, (&len, &dp)) in self.lengths.iter().zip(&self.depths).enumerate() {
            text += &format!("S\ts{i}\t{}\tdp:f:{dp}\n", "A".repeat(len as usize));
        }
        let sign = |r: bool| if r { '-' } else { '+' };
        for &(a, ar, b, br) in &self.links {
            text += &format!("L\ts{a}\t{}\ts{b}\t{}\t0M\n", sign(ar), sign(br));
        }
        text
    }

    fn naive(&self) -> Naive {
        let n = self.lengths.len();
        let canonical = |&(a, ar, b, br): &(usize, bool, usize, bool)| {
            let given = ((a, ar), (b, br));
            let mirror = ((b, !br), (a, !ar));
            given.min(mirror)
        };
        let mut unique: Vec<_> = self.links.iter().map(canonical).collect();
        unique.sort_unstable();
        unique.dedup();

        let mut touched = vec![[false; 2]; n];
        for &((a, ar), (b, br)) in &unique {
            touched[a][usize::from(!ar)] = true;
            touched[b][usize::from(br)] = true;
        }
        let dead_ends = touched
            .iter()
            .map(|t| t.iter().filter(|&&x| !x).count() as u64)
            .sum();
        let isolated = touched.iter().filter(|t| !t[0] && !t[1]).count() as u64;

        let mut label: Vec<usize> = (0..n).collect();
        loop {
            let mut changed = false;
            for &((a, _), (b, _)) in &unique {
                let m = label[a].min(label[b]);
                if label[a] != m || label[b] != m {
                    let (la, lb) = (label[a], label[b]);
                    for l in label.iter_mut() {
                        if *l == la || *l == lb {
                            *l = m;
                        }
                    }
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        let mut components: Vec<u64> = (0..n)
            .filter(|&r| label.contains(&r))
            .map(|r| {
                (0..n)
                    .filter(|&s| label[s] == r)
                    .map(|s| u64::from(self.lengths[s]))
                    .sum()
            })
            .collect();
        components.sort_unstable_by(|a, b| b.cmp(a));

        let mut sorted = self.lengths.clone();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        let total: u64 = sorted.iter().map(|&l| u64::from(l)).sum();
        let nx = |fraction: f64| {
            let mut sum = 0;
            for &l in &sorted {
                sum += u64::from(l);
                if sum as f64 >= total as f64 * fraction {
                    return l;
                }
            }
            0
        };
        let weighted: f64 = self
            .lengths
            .iter()
            .zip(&self.depths)
            .map(|(&l, &d)| f64::from(l) * f64::from(d))
            .sum();

        Naive {
            total,
            n50: nx(0.5),
            n75: nx(0.75),
            dead_ends,
            isolated,
            components,
            links: unique.len() as u64,
            mean_depth: weighted / total as f64,
        }
    }
}
