#![no_main]

use gfa_core::pack::{pack, unpack};
use libfuzzer_sys::fuzz_target;

// Packing any input gives it back, and unpacking any input never panics.
fuzz_target!(|data: &[u8]| {
    assert_eq!(unpack(&pack(data)).as_deref(), Ok(data));
    let _ = unpack(data);
});
