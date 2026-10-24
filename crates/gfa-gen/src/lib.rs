//! Assembly-like graphs: chains of segments, some closed into circles, with
//! bubbles, tips and repeats that many chains pass through. Sequences are
//! random and do not honour the overlaps; the graphs are for structure and
//! speed, not for sequence-level checks.

use std::io::{self, Write};

#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    pub segments: u32,
    pub seed: u64,
    pub mean_length: u32,
    pub overlap: u32,
    pub components: u32,
    pub bubbles: f64,
    pub tips: f64,
    pub repeats: f64,
    pub sequences: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            segments: 1000,
            seed: 1,
            mean_length: 1000,
            overlap: 0,
            components: 10,
            bubbles: 0.05,
            tips: 0.05,
            repeats: 0.01,
            sequences: true,
        }
    }
}

/// splitmix64, so output depends only on the seed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: u32) -> u32 {
        (self.unit() * f64::from(n)) as u32
    }
}

struct Link {
    from: u32,
    from_reverse: bool,
    to: u32,
    to_reverse: bool,
}

pub fn generate(options: &Options, out: &mut impl Write) -> io::Result<()> {
    let mut rng = Rng(options.seed);
    let n = options.segments.max(1);
    let extras = |fraction: f64| (f64::from(n) * fraction.clamp(0.0, 1.0)) as u32;
    let (bubbles, tips, repeats) = (
        extras(options.bubbles),
        extras(options.tips),
        extras(options.repeats),
    );
    let backbone = n.saturating_sub(bubbles + tips + repeats).max(1);
    let components = options.components.clamp(1, backbone);

    let mut links = Vec::new();
    let link = |links: &mut Vec<Link>, from, to| {
        links.push(Link {
            from,
            from_reverse: false,
            to,
            to_reverse: false,
        })
    };

    let chains: Vec<(u32, u32)> = (0..components)
        .map(|c| {
            let edge = |c: u32| {
                (u64::from(c) * u64::from(backbone)).div_ceil(u64::from(components)) as u32
            };
            (edge(c), edge(c + 1) - 1)
        })
        .collect();
    for (c, &(first, last)) in chains.iter().enumerate() {
        for s in first..last {
            link(&mut links, s, s + 1);
        }
        if c % 2 == 0 && last > first {
            link(&mut links, last, first);
        }
    }

    // Extras stay inside one chain so the components remain separate.
    let pick = |rng: &mut Rng| chains[rng.below(components) as usize];
    let mut next = backbone;
    for _ in 0..bubbles {
        let (first, last) = pick(&mut rng);
        let s = first + rng.below(last - first + 1);
        link(&mut links, s, next);
        if s + 2 <= last {
            link(&mut links, next, s + 2);
        }
        next += 1;
    }
    for _ in 0..tips {
        let (first, last) = pick(&mut rng);
        link(&mut links, first + rng.below(last - first + 1), next);
        next += 1;
    }
    for _ in 0..repeats {
        let (first, last) = pick(&mut rng);
        for _ in 0..3 {
            link(&mut links, first + rng.below(last - first + 1), next);
            link(&mut links, next, first + rng.below(last - first + 1));
        }
        next += 1;
    }
    for l in links.iter_mut() {
        if rng.below(4) == 0 {
            l.to_reverse = true;
        }
    }

    writeln!(out, "H\tVN:Z:1.0")?;
    let mut seq = Vec::new();
    for s in 0..n {
        let tip = s >= backbone + bubbles && s < backbone + bubbles + tips;
        let mean = f64::from(options.mean_length) * if tip { 0.1 } else { 1.0 };
        let length = (-mean * (1.0 - rng.unit()).ln()) as u32 + options.overlap + 1;
        let depth = 20.0 * (0.5 + rng.unit()) * if s >= n - repeats { 2.0 } else { 1.0 };
        write!(out, "S\t{}\t", s + 1)?;
        if options.sequences {
            random_bases(&mut rng, length, &mut seq);
            out.write_all(&seq)?;
            writeln!(out, "\tdp:f:{depth:.2}")?;
        } else {
            writeln!(out, "*\tLN:i:{length}\tdp:f:{depth:.2}")?;
        }
    }
    for l in &links {
        let sign = |r: bool| if r { '-' } else { '+' };
        writeln!(
            out,
            "L\t{}\t{}\t{}\t{}\t{}M",
            l.from + 1,
            sign(l.from_reverse),
            l.to + 1,
            sign(l.to_reverse),
            options.overlap
        )?;
    }
    Ok(())
}

fn random_bases(rng: &mut Rng, length: u32, out: &mut Vec<u8>) {
    out.clear();
    let mut bits = 0u64;
    for i in 0..length {
        if i % 32 == 0 {
            bits = rng.next();
        }
        out.push(b"ACGT"[(bits & 3) as usize]);
        bits >>= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(options: &Options) -> Vec<u8> {
        let mut out = Vec::new();
        generate(options, &mut out).unwrap();
        out
    }

    #[test]
    fn same_seed_same_graph() {
        let o = Options::default();
        assert_eq!(text(&o), text(&o));
        assert_ne!(text(&o), text(&Options { seed: 2, ..o }));
    }

    #[test]
    fn parses_cleanly_with_the_requested_size() {
        let o = Options {
            segments: 5000,
            ..Options::default()
        };
        let graph = gfa_core::parse(&text(&o), gfa_core::ParseOptions::default()).unwrap();
        assert_eq!(graph.stats.segments, 5000);
        assert_eq!(graph.warnings.total, 0);
        assert!(graph.stats.components >= u64::from(o.components));
    }

    #[test]
    fn sequence_free_output_uses_ln() {
        let o = Options {
            segments: 100,
            sequences: false,
            ..Options::default()
        };
        let graph = gfa_core::parse(&text(&o), gfa_core::ParseOptions::default()).unwrap();
        assert!(graph.stats.total_length > 0);
        assert!(graph.stats.gc.is_nan());
    }
}
