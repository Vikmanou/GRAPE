//! Chain merging keeps what the graph spells: any walk through the merged
//! graph spells the same bases as the walk through the original segments it
//! stands for.

use gfa_core::analysis::chains::{is_reverse, reversed, segment_of, step};
use gfa_core::analysis::merge::{Merged, merge};
use gfa_core::analysis::paths::overlap_into;
use gfa_core::{Graph, ParseOptions, parse, reverse_complement};
use proptest::prelude::*;

#[derive(Debug, Clone)]
struct Case {
    sequences: Vec<Vec<u8>>,
    links: Vec<(usize, bool, usize, bool)>,
}

/// Two letters make real overlaps common.
fn case() -> impl Strategy<Value = Case> {
    (1usize..20).prop_flat_map(|n| {
        (
            prop::collection::vec(
                prop::collection::vec(prop::sample::select(vec![b'A', b'C']), 1..8),
                n,
            ),
            prop::collection::vec((0..n, any::<bool>(), 0..n, any::<bool>()), 0..n * 2),
        )
            .prop_map(|(sequences, links)| Case { sequences, links })
    })
}

fn oriented(seq: &[u8], reverse: bool) -> Vec<u8> {
    if reverse {
        reverse_complement(seq)
    } else {
        seq.to_vec()
    }
}

impl Case {
    /// Each link overlaps by the longest run, up to 3, where the bases agree.
    fn gfa(&self) -> String {
        let mut text = String::new();
        for (i, seq) in self.sequences.iter().enumerate() {
            text += &format!("S\ts{i}\t{}\n", String::from_utf8_lossy(seq));
        }
        let sign = |r: bool| if r { '-' } else { '+' };
        for &(a, ar, b, br) in &self.links {
            let x = oriented(&self.sequences[a], ar);
            let y = oriented(&self.sequences[b], br);
            let k = (0..=3.min(x.len()).min(y.len()))
                .rev()
                .find(|&k| x[x.len() - k..] == y[..k])
                .unwrap_or(0);
            text += &format!("L\ts{a}\t{}\ts{b}\t{}\t{k}M\n", sign(ar), sign(br));
        }
        text
    }
}

fn spell(g: &Graph, walk: &[u32], bases: &dyn Fn(u32) -> Vec<u8>) -> Vec<u8> {
    let mut out = Vec::new();
    for (k, &s) in walk.iter().enumerate() {
        let seq = oriented(&bases(segment_of(s)), is_reverse(s));
        let trim = if k == 0 {
            0
        } else {
            overlap_into(g, walk[k - 1], s) as usize
        };
        out.extend_from_slice(if trim <= seq.len() {
            &seq[trim..]
        } else {
            &seq
        });
    }
    out
}

fn merged_bases(m: &Merged, bases: &dyn Fn(u32) -> Vec<u8>, segment: u32) -> Vec<u8> {
    let (steps, trims) = m.steps_of(segment);
    let mut out = Vec::new();
    for (&s, &trim) in steps.iter().zip(trims) {
        let seq = oriented(&bases(segment_of(s)), is_reverse(s));
        out.extend_from_slice(&seq[trim as usize..]);
    }
    out
}

/// Walks from each merged segment in each orientation, taking the link `choice` picks at each end.
fn walks(g: &Graph, choices: &[usize]) -> Vec<Vec<u32>> {
    let mut out = Vec::new();
    for start in 0..g.segments.len() as u32 {
        for reverse in [false, true] {
            let mut walk = vec![step(start, reverse)];
            for &choice in choices {
                let last = *walk.last().unwrap_or(&0);
                let leave = segment_of(last) * 2 + u32::from(!is_reverse(last));
                let next = g.adjacency.neighbours(leave);
                if next.is_empty() {
                    break;
                }
                let target = next[choice % next.len()];
                walk.push(step(target / 2, target % 2 == 1));
            }
            out.push(walk);
        }
    }
    out
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn merged_walks_spell_what_the_original_walks_spell(c in case(), choices in prop::collection::vec(0usize..4, 0..6)) {
        let original = parse(c.gfa().as_bytes(), ParseOptions::default()).unwrap();
        let by_name = |s: u32| {
            let name = String::from_utf8_lossy(original.names.get(s)).into_owned();
            c.sequences[name[1..].parse::<usize>().unwrap()].clone()
        };
        let m = merge(&original).unwrap();

        let mut seen = vec![0; original.segments.len()];
        for &s in &m.steps {
            seen[segment_of(s) as usize] += 1;
        }
        prop_assert!(seen.iter().all(|&k| k == 1));
        let trimmed: u64 = m.trims.iter().map(|&t| u64::from(t)).sum();
        prop_assert_eq!(m.graph.stats.total_length + trimmed, original.stats.total_length);

        let merged_seq = |s: u32| merged_bases(&m, &by_name, s);
        for walk in walks(&m.graph, &choices) {
            let expanded: Vec<u32> = walk
                .iter()
                .flat_map(|&s| {
                    let (steps, _) = m.steps_of(segment_of(s));
                    if is_reverse(s) { reversed(steps) } else { steps.to_vec() }
                })
                .collect();
            prop_assert_eq!(spell(&m.graph, &walk, &merged_seq), spell(&original, &expanded, &by_name));
        }
    }
}
