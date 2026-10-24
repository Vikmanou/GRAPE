//! Times the CPU reference layout on a file and can draw the result.
//! `cargo run -p gfa-core --release --example layout_file -- <path> [--seed N] [--iterations N] [--svg out.svg]`

use gfa_core::layout::{Layout, LayoutOptions, link_points, measure};
use gfa_core::{ParseOptions, parse};
use std::fmt::Write;
use std::time::Instant;

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: layout_file <path> [--seed N] [--iterations N] [--svg out.svg]");
        std::process::exit(2);
    };
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let graph = parse(&bytes, ParseOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let mut options = LayoutOptions::default();
    if let Some(seed) = arg("--seed") {
        options.seed = seed.parse().expect("--seed takes a number");
    }
    if let Some(n) = arg("--refine") {
        options.refine_iterations = n.parse().expect("--refine takes a number");
    }
    if let Some(n) = arg("--iterations") {
        options.iterations = n.parse().expect("--iterations takes a number");
    }

    let start = Instant::now();
    let mut layout = Layout::new(graph.topology(), options).unwrap_or_else(|e| panic!("{e}"));
    let built = start.elapsed().as_secs_f64();
    let stop = arg("--stop").map_or(u32::MAX, |n| n.parse().expect("--stop takes a number"));
    while layout.iteration() < stop && !layout.step(10) {}
    let seconds = start.elapsed().as_secs_f64();
    let mut positions = Vec::new();
    layout.write_positions(&mut positions);
    let total = start.elapsed().as_secs_f64();
    println!("segments    {}", graph.stats.segments);
    println!("links       {}", graph.stats.links);
    println!("points      {}", layout.points());
    println!("levels      {}", layout.levels());
    println!(
        "layout      {:.0} ms ({} iterations, {:.2} ms each; setup {:.0} ms, pack {:.0} ms)",
        total * 1e3,
        layout.total_iterations(),
        (seconds - built) * 1e3 / f64::from(layout.total_iterations().max(1)),
        built * 1e3,
        (total - seconds) * 1e3
    );
    let q = measure(&layout, &positions);
    println!(
        "quality     edge cv {:.3}, link stretch {:.2}, overlaps {}",
        q.edge_cv, q.link_stretch, q.overlaps
    );

    if let Some(out) = arg("--svg") {
        let svg = draw(&graph, &layout, &positions);
        std::fs::write(&out, svg).unwrap_or_else(|e| panic!("{out}: {e}"));
    }
}

fn draw(graph: &gfa_core::Graph, layout: &Layout, p: &[f32]) -> String {
    let (mut x1, mut y1) = (0.0f32, 0.0f32);
    for xy in p.chunks(2) {
        x1 = x1.max(xy[0]);
        y1 = y1.max(xy[1]);
    }
    let mut s = String::new();
    writeln!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 {} {}" style="background:#f7f7f5">"#,
        x1 + 20.0,
        y1 + 20.0
    )
    .unwrap();
    let t = graph.topology();
    let c = &layout.chains;
    for i in 0..t.link_from.len() {
        let (a, b) = link_points(&t, c, i);
        let (a, b) = (a as usize * 2, b as usize * 2);
        writeln!(
            s,
            r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#444" stroke-width="1" vector-effect="non-scaling-stroke"/>"##,
            p[a],
            p[a + 1],
            p[b],
            p[b + 1]
        )
        .unwrap();
    }
    for seg in 0..t.lengths.len() as u32 {
        let hue = (seg as u64).wrapping_mul(2_654_435_761) % 360;
        let mut points = String::new();
        for q in c.first(seg)..=c.last(seg) {
            let q = q as usize * 2;
            write!(points, "{},{} ", p[q], p[q + 1]).unwrap();
        }
        writeln!(
            s,
            r#"<polyline points="{points}" fill="none" stroke="hsl({hue},50%,60%)" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>"#
        )
        .unwrap();
    }
    s.push_str("</svg>\n");
    s
}
