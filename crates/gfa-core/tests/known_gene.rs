//! The csgA gene of Myxococcus xanthus DK1622 (NCBI NC_008095.1:1520199-1520888)
//! in a graph of ten M. xanthus assemblies. The graph is a large sample, not
//! committed: `npm run samples -- --large`, then run this in release mode.

mod common;

use gfa_core::search::join::LinkTable;
use gfa_core::search::kmer::{DEFAULT_K, IndexBuilder};
use gfa_core::search::search;
use gfa_core::{DEFAULT_BUDGET, ParseOptions, SeqMode, bases_from_packed, parse};
use std::process::{Command, Stdio};
use std::time::Instant;

fn gunzip(path: &str) -> Vec<u8> {
    let file = std::fs::File::open(path).unwrap();
    let out = Command::new("gzip")
        .arg("-dc")
        .stdin(Stdio::from(file))
        .output()
        .unwrap();
    out.stdout
}

#[test]
fn finds_csg_a_in_the_myxococcus_graph() {
    let path = format!(
        "{}/../../samples/myxococcus-10-assemblies.gfa.gz",
        env!("CARGO_MANIFEST_DIR")
    );
    if !std::path::Path::new(&path).exists() {
        println!("skipped: {path} is not downloaded");
        return;
    }
    let file = gunzip(&path);
    let options = ParseOptions {
        seq_mode: SeqMode::Packed {
            budget_bytes: DEFAULT_BUDGET,
        },
    };
    let g = parse(&file, options).unwrap();
    let packed = g.packed.as_ref().unwrap();
    let started = Instant::now();
    let s = &g.segments;
    let mut builder = IndexBuilder::new(s.len(), DEFAULT_K);
    for i in 0..s.len() {
        let bases = bases_from_packed(packed, s.seq[i], s.length[i], s.flags[i]).unwrap();
        builder.add(i as u32, &bases).unwrap();
    }
    builder.plan().unwrap();
    while !builder.step(1 << 26).unwrap() {}
    let index = builder.finish();
    let built = started.elapsed();
    let links = LinkTable::from_links(s.len(), &g.links);

    let fasta = common::testdata("csgA.fasta");
    let query: Vec<u8> = fasta
        .split(|&b| b == b'\n')
        .filter(|line| line.first() != Some(&b'>'))
        .flatten()
        .copied()
        .collect();
    let started = Instant::now();
    let found = search(&index, &links, &query);
    let searched = started.elapsed();
    let top = &found.hits[0];
    let coverage = f64::from(top.q_end - top.q_start) / query.len() as f64;
    let identity = f64::from(top.matches) / f64::from(top.columns);
    println!(
        "index {:.1} s, {} MB; search {:.0} ms; {} hits; top {} parts, coverage {:.3}, identity {:.4}, {:?}",
        built.as_secs_f64(),
        index.heap_bytes() / (1 << 20),
        searched.as_secs_f64() * 1000.0,
        found.total,
        top.parts.len(),
        coverage,
        identity,
        found.skipped,
    );
    assert!(coverage >= 0.99, "coverage {coverage}");
    assert!(identity >= 1.0, "identity {identity}");
}
