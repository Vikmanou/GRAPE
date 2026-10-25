//! Measures a layout made elsewhere (the GPU's, read back from the browser)
//! against the CPU reference on the same graph, seed and iteration budget.
//! `cargo run -p gfa-core --release --example compare_layout -- <graph> <positions.f32> [--seed N] [--coarsest N] [--refine N] [--cpu-cache path.f32]`
//! Positions files are `x, y` per point as little-endian f32. Prints one JSON line.

use gfa_core::layout::{Layout, LayoutOptions, Quality, measure};
use gfa_core::{ParseOptions, parse};
use std::time::Instant;

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn number<T: std::str::FromStr>(name: &str, default: T) -> T {
    arg(name).map_or(default, |v| {
        v.parse()
            .unwrap_or_else(|_| panic!("{name} takes a number"))
    })
}

fn read_f32(path: &str) -> Vec<f32> {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&b| f32::from_le_bytes(b))
        .collect()
}

fn json(q: &Quality) -> String {
    format!(
        r#"{{"edgeCv":{:.4},"linkStretch":{:.3},"overlaps":{}}}"#,
        q.edge_cv, q.link_stretch, q.overlaps
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(graph_path), Some(gpu_path)) = (args.get(1), args.get(2)) else {
        eprintln!(
            "usage: compare_layout <graph> <positions.f32> [--seed N] [--coarsest N] [--refine N] [--cpu-cache path.f32]"
        );
        std::process::exit(2);
    };
    let bytes = std::fs::read(graph_path).unwrap_or_else(|e| panic!("{graph_path}: {e}"));
    let graph = parse(&bytes, ParseOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let defaults = LayoutOptions::default();
    let options = LayoutOptions {
        seed: number("--seed", defaults.seed),
        coarsest_iterations: number("--coarsest", defaults.coarsest_iterations),
        refine_iterations: number("--refine", defaults.refine_iterations),
        ..defaults
    };
    let mut layout = Layout::new(graph.topology(), options).unwrap_or_else(|e| panic!("{e}"));
    let points = layout.points();

    let cache = arg("--cpu-cache");
    let cached = cache
        .as_deref()
        .filter(|p| std::path::Path::new(p).exists())
        .map(read_f32)
        .filter(|p| p.len() == points * 2);
    let started = Instant::now();
    let (cpu, cpu_ms) = match cached {
        Some(positions) => (positions, None),
        None => {
            while !layout.step(64) {}
            let mut positions = Vec::new();
            layout.write_positions(&mut positions);
            let ms = started.elapsed().as_secs_f64() * 1e3;
            if let Some(path) = &cache {
                let bytes: Vec<u8> = positions.iter().flat_map(|v| v.to_le_bytes()).collect();
                std::fs::write(path, bytes).unwrap_or_else(|e| panic!("{path}: {e}"));
            }
            (positions, Some(ms))
        }
    };
    let gpu = read_f32(gpu_path);
    if gpu.len() != points * 2 {
        eprintln!(
            "{gpu_path} holds {} values; the layout has {points} points",
            gpu.len()
        );
        std::process::exit(1);
    }
    println!(
        r#"{{"segments":{},"points":{},"cpuMs":{},"cpu":{},"gpu":{}}}"#,
        graph.stats.segments,
        points,
        cpu_ms.map_or("null".to_owned(), |ms| format!("{ms:.0}")),
        json(&measure(&layout, &cpu)),
        json(&measure(&layout, &gpu))
    );
}
