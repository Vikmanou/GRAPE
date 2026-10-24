#![no_main]

use gfa_core::{ParseOptions, Parser, SeqMode};
use libfuzzer_sys::fuzz_target;

// The first byte picks the chunk size and sequence mode, so chunk boundaries
// and packing are fuzzed along with the content.
fuzz_target!(|data: &[u8]| {
    let Some((&control, input)) = data.split_first() else {
        return;
    };
    let chunk = usize::from(control & 0x7f) + 1;
    let seq_mode = if control & 0x80 == 0 {
        SeqMode::FileOffsets
    } else {
        SeqMode::Packed { budget_bytes: 64 }
    };
    let mut parser = Parser::new(ParseOptions { seq_mode });
    for piece in input.chunks(chunk) {
        parser.push(piece);
    }
    let _ = parser.finish();
});
