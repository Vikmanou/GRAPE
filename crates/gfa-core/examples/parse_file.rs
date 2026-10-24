//! Times a native parse in 4 MB chunks, as the parse worker reads files.
//! `cargo run -p gfa-core --release --example parse_file -- <path>`

use gfa_core::{DEFAULT_BUDGET, ParseOptions, Parser, PathKind, SeqMode};
use std::time::Instant;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: parse_file <path> [--packed] [--warnings]");
        std::process::exit(2);
    };
    let packed = std::env::args().any(|a| a == "--packed");
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let seq_mode = if packed {
        SeqMode::Packed {
            budget_bytes: DEFAULT_BUDGET,
        }
    } else {
        SeqMode::FileOffsets
    };
    let start = Instant::now();
    let mut parser = Parser::new(ParseOptions { seq_mode });
    for chunk in bytes.chunks(4 << 20) {
        parser.push(chunk);
    }
    let graph = parser.finish().unwrap_or_else(|e| panic!("{e}"));
    let seconds = start.elapsed().as_secs_f64();
    let mb = bytes.len() as f64 / 1e6;
    let memory = graph.memory();
    println!("file        {mb:.1} MB");
    println!(
        "parse       {:.0} ms, {:.0} MB/s",
        seconds * 1e3,
        mb / seconds
    );
    println!("format      {:?}", graph.format);
    println!("segments    {}", graph.stats.segments);
    println!("links       {}", graph.stats.links);
    println!("components  {}", graph.stats.components);
    println!("length      {}", graph.stats.total_length);
    println!("n50         {}", graph.stats.n50);
    println!("paths       {}", graph.paths.count(PathKind::Path));
    println!("walks       {}", graph.paths.count(PathKind::Walk));
    println!("warnings    {}", graph.warnings.total);
    println!(
        "per segment {:.1} bytes (names {:.1} more)",
        memory.per_segment,
        memory.name_bytes as f64 / graph.segments.len() as f64
    );
    println!("sequence    {:.1} MB", memory.sequence_bytes as f64 / 1e6);
    if std::env::args().any(|a| a == "--warnings") {
        for w in graph.warnings.list.iter().take(20) {
            println!("  line {}: {}", w.line, w.message);
        }
    }
}
