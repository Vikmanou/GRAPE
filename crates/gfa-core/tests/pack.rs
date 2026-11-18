mod common;

use common::testdata;
use gfa_core::pack::{PackError, pack, pack_within, unpack};
use proptest::prelude::*;

#[test]
fn every_test_file_round_trips() {
    for entry in std::fs::read_dir(format!(
        "{}/../../data/fixtures",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    {
        let name = entry.unwrap().file_name().into_string().unwrap();
        let file = testdata(&name);
        assert_eq!(unpack(&pack(&file)).unwrap(), file, "{name}");
    }
}

#[test]
fn packing_stops_at_the_limit() {
    let file = testdata("paths.gfa");
    let size = pack(&file).len();
    assert_eq!(pack_within(&file, size), Some(pack(&file)));
    assert_eq!(pack_within(&file, size - 1), None);
}

#[test]
fn damage_is_reported_not_returned() {
    let file = testdata("paths.gfa");
    let packed = pack(&file);
    assert_eq!(unpack(&packed[..packed.len() / 2]), Err(PackError::Corrupt));
    let mut flipped = packed.clone();
    let last = flipped.len() - 6;
    flipped[last] ^= 0x10;
    assert!(unpack(&flipped).is_err());
    let mut newer = packed;
    newer[1] = 2;
    assert_eq!(unpack(&newer), Err(PackError::Version));
    assert_eq!(unpack(b""), Err(PackError::Corrupt));
}

fn gfa_line() -> impl Strategy<Value = String> {
    prop_oneof![
        (
            "[a-z0-9_]{1,8}",
            "[ACGTNacgtn*RY]{0,40}",
            "(\tLN:i:[0-9]{1,3})?"
        )
            .prop_map(|(n, s, t)| format!("S\t{n}\t{s}{t}")),
        ("[a-z0-9]{1,4}", "[+-]", "[a-z0-9]{1,4}", "[+-]")
            .prop_map(|(a, x, b, y)| format!("L\t{a}\t{x}\t{b}\t{y}\t0M")),
        ">[a-z0-9 ]{0,10}".prop_map(String::from),
        "[ACGTNacgt]{0,30}".prop_map(String::from),
        "[ -~\t]{0,20}".prop_map(String::from),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    #[test]
    fn graph_like_files_round_trip(lines in prop::collection::vec(gfa_line(), 0..40), crlf: bool, last_newline: bool) {
        let end = if crlf { "\r\n" } else { "\n" };
        let mut file = lines.join(end);
        if last_newline {
            file.push_str(end);
        }
        prop_assert_eq!(unpack(&pack(file.as_bytes())).unwrap(), file.as_bytes());
    }

    #[test]
    fn any_bytes_round_trip(file in prop::collection::vec(any::<u8>(), 0..300)) {
        prop_assert_eq!(unpack(&pack(&file)).unwrap(), file);
    }

    #[test]
    fn any_input_unpacks_without_panicking(data in prop::collection::vec(any::<u8>(), 0..200)) {
        let _ = unpack(&data);
    }
}
