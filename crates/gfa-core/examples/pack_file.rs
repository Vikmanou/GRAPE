//! Packs graph files as a share link would and reports sizes and times:
//! `cargo run -p gfa-core --release --example pack_file -- <file>...`.
//! Gzipped files are read through `gzip -dc`.

use std::process::Command;
use std::time::Instant;

fn main() {
    for path in std::env::args().skip(1) {
        let file = if path.ends_with(".gz") {
            Command::new("gzip")
                .args(["-dc", &path])
                .output()
                .expect("gzip")
                .stdout
        } else {
            std::fs::read(&path).expect("read")
        };
        let t = Instant::now();
        let packed = gfa_core::pack::pack(&file);
        let packing = t.elapsed();
        let t = Instant::now();
        let back = gfa_core::pack::unpack(&packed).expect("unpack");
        let unpacking = t.elapsed();
        assert!(back == file, "{path}: round trip differs");
        let link = packed.len().div_ceil(3) * 4;
        println!(
            "{path}\traw {}\tpacked {}\tlink {link}\tpack {:.2}s\tunpack {:.2}s",
            file.len(),
            packed.len(),
            packing.as_secs_f64(),
            unpacking.as_secs_f64()
        );
    }
}
