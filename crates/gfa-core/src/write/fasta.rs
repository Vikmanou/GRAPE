//! FASTA exactly as Bandage writes it, so exports match byte for byte
//! (<https://github.com/rrwick/Bandage>):
//! "Save selected node sequences" writes `getFasta(true)` per selected node in
//! `compareNodePointers` order (ui/mainwindow.cpp, ui/mygraphicsscene.cpp);
//! `getFasta` and `getNodeNameForFasta` are in graph/debruijnnode.cpp, and
//! `addNewlinesToSequence` (70 columns) in graph/assemblygraph.cpp.

use std::cmp::Ordering;

pub const LINE_WIDTH: usize = 70;

/// Bandage gives a segment without depth tags a depth of 1.0.
pub const DEFAULT_DEPTH: f64 = 1.0;

/// One record. Without a sequence Bandage writes N for every base.
pub fn write_record(
    out: &mut Vec<u8>,
    name: &[u8],
    length: u32,
    depth: f32,
    sequence: Option<&[u8]>,
) {
    out.extend_from_slice(b">NODE_");
    out.extend_from_slice(name);
    out.extend_from_slice(b"+_length_");
    out.extend_from_slice(length.to_string().as_bytes());
    out.extend_from_slice(b"_cov_");
    let depth = if depth.is_nan() {
        DEFAULT_DEPTH
    } else {
        f64::from(depth)
    };
    out.extend_from_slice(format_g(depth).as_bytes());
    out.push(b'\n');
    let ns;
    let sequence = match sequence {
        Some(s) => s,
        None => {
            ns = vec![b'N'; length as usize];
            &ns
        }
    };
    let mut rest = sequence;
    while rest.len() > LINE_WIDTH {
        out.extend_from_slice(&rest[..LINE_WIDTH]);
        out.push(b'\n');
        rest = &rest[LINE_WIDTH..];
    }
    out.extend_from_slice(rest);
    out.push(b'\n');
}

/// Bandage's `compareNodePointers`: numerically when both names are integers
/// that differ, otherwise by the names with their `+` sign.
pub fn bandage_order(a: &[u8], b: &[u8]) -> Ordering {
    if let (Some(x), Some(y)) = (integer(a), integer(b))
        && x != y
    {
        return x.cmp(&y);
    }
    a.iter().chain(b"+").cmp(b.iter().chain(b"+"))
}

/// What Qt's `QString::toLongLong` accepts: an optional sign, then decimal digits.
fn integer(name: &[u8]) -> Option<i64> {
    std::str::from_utf8(name).ok()?.trim_ascii().parse().ok()
}

/// `QByteArray::number(double)`: printf's `%g` with 6 significant digits.
pub fn format_g(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    if !value.is_finite() {
        return if value.is_nan() {
            "nan"
        } else if value > 0.0 {
            "inf"
        } else {
            "-inf"
        }
        .to_owned();
    }
    let scientific = format!("{value:.5e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    if !(-4..6).contains(&exponent) {
        let sign = if exponent < 0 { '-' } else { '+' };
        return format!("{}e{sign}{:02}", trim_zeros(mantissa), exponent.abs());
    }
    let decimals = (5 - exponent).max(0) as usize;
    trim_zeros(&format!("{value:.decimals$}")).to_owned()
}

fn trim_zeros(number: &str) -> &str {
    if number.contains('.') {
        number.trim_end_matches('0').trim_end_matches('.')
    } else {
        number
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depth_prints_like_printf_g() {
        let cases = [
            (57.3, "57.3"),
            (14.25, "14.25"),
            (1.0, "1"),
            (123456.0, "123456"),
            (1234567.0, "1.23457e+06"),
            (999999.5, "1e+06"),
            (0.0001, "0.0001"),
            (0.00001234, "1.234e-05"),
            (2.0 / 3.0, "0.666667"),
            (100.0, "100"),
        ];
        for (value, text) in cases {
            assert_eq!(format_g(value), text, "{value}");
        }
    }

    #[test]
    fn records_wrap_at_70_and_fill_missing_sequence_with_n() {
        let mut out = Vec::new();
        let seq = vec![b'A'; 141];
        write_record(&mut out, b"12", 141, 14.2, Some(&seq));
        write_record(&mut out, b"x", 3, f32::NAN, None);
        let text = String::from_utf8(out).unwrap();
        let a70 = "A".repeat(70);
        assert_eq!(
            text,
            format!(
                ">NODE_12+_length_141_cov_14.2\n{a70}\n{a70}\nA\n>NODE_x+_length_3_cov_1\nNNN\n"
            )
        );
    }

    #[test]
    fn exactly_70_bases_take_one_line() {
        let mut out = Vec::new();
        write_record(&mut out, b"a", 70, 1.0, Some(&[b'C'; 70]));
        assert_eq!(out.iter().filter(|&&b| b == b'\n').count(), 2);
    }

    #[test]
    fn order_is_numeric_then_by_signed_name() {
        let mut names: Vec<&[u8]> = vec![b"10", b"9", b"b", b"a", b"007", b"7", b"a!", b"-3"];
        names.sort_by(|a, b| bandage_order(a, b));
        assert_eq!(
            names,
            [&b"-3"[..], b"007", b"7", b"9", b"10", b"a!", b"a", b"b"]
        );
    }
}
