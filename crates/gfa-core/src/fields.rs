//! Grammar from the GFA 1 spec:
//! <https://github.com/GFA-spec/GFA-spec/blob/master/GFA1.md>

/// Returns `true` for reverse.
pub(crate) fn orientation(field: &[u8]) -> Option<bool> {
    match field {
        b"+" => Some(false),
        b"-" => Some(true),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Tag<'a> {
    pub name: [u8; 2],
    pub ty: u8,
    pub value: &'a [u8],
}

pub(crate) fn tag(field: &[u8]) -> Option<Tag<'_>> {
    match field {
        [a, b, b':', ty, b':', value @ ..]
            if a.is_ascii_alphabetic() && b.is_ascii_alphanumeric() && !value.is_empty() =>
        {
            Some(Tag {
                name: [*a, *b],
                ty: *ty,
                value,
            })
        }
        _ => None,
    }
}

pub(crate) fn number(value: &[u8]) -> Option<f64> {
    std::str::from_utf8(value)
        .ok()?
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}

pub(crate) fn unsigned(value: &[u8]) -> Option<u64> {
    let digits = value.strip_prefix(b"+").unwrap_or(value);
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(digits).ok()?.parse().ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Overlap {
    Unknown,
    Cigar(Cigar),
}

/// The GFA 1 spec makes the From segment the reference and the To segment the
/// query, so the two sides of one overlap can differ in length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Cigar {
    pub reference: u32,
    pub query: u32,
    /// Only `M`, `=` and `X`.
    pub simple: bool,
}

pub(crate) fn overlap(field: &[u8]) -> Option<Overlap> {
    if field == b"*" {
        return Some(Overlap::Unknown);
    }
    let mut cigar = Cigar {
        reference: 0,
        query: 0,
        simple: true,
    };
    let mut count: u32 = 0;
    let mut digits = false;
    for &b in field {
        if b.is_ascii_digit() {
            count = count.saturating_mul(10).saturating_add(u32::from(b - b'0'));
            digits = true;
            continue;
        }
        if !digits {
            return None;
        }
        // Which side each operation consumes, as in SAM.
        let (reference, query) = match b {
            b'M' | b'=' | b'X' => (true, true),
            b'D' | b'N' => (true, false),
            b'I' | b'S' => (false, true),
            b'H' | b'P' => (false, false),
            _ => return None,
        };
        cigar.simple &= reference && query;
        if reference {
            cigar.reference = cigar.reference.saturating_add(count);
        }
        if query {
            cigar.query = cigar.query.saturating_add(count);
        }
        count = 0;
        digits = false;
    }
    if digits || field.is_empty() {
        return None;
    }
    Some(Overlap::Cigar(cigar))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orientations() {
        assert_eq!(orientation(b"+"), Some(false));
        assert_eq!(orientation(b"-"), Some(true));
        assert_eq!(orientation(b"x"), None);
        assert_eq!(orientation(b""), None);
    }

    #[test]
    fn tags() {
        let t = tag(b"dp:f:12.5").unwrap();
        assert_eq!((&t.name, t.ty, t.value), (b"dp", b'f', &b"12.5"[..]));
        assert!(tag(b"LN:i:").is_none());
        assert!(tag(b"1N:i:5").is_none());
        assert!(tag(b"LNi5").is_none());
        assert!(tag(b"LN:i5x").is_none());
    }

    #[test]
    fn numbers() {
        assert_eq!(number(b"12.5"), Some(12.5));
        assert_eq!(number(b"-3"), Some(-3.0));
        assert_eq!(number(b"1e3"), Some(1000.0));
        assert_eq!(number(b"inf"), None);
        assert_eq!(number(b"abc"), None);
        assert_eq!(unsigned(b"42"), Some(42));
        assert_eq!(unsigned(b"+42"), Some(42));
        assert_eq!(unsigned(b"-1"), None);
        assert_eq!(unsigned(b""), None);
    }

    #[test]
    fn overlaps() {
        assert_eq!(overlap(b"*"), Some(Overlap::Unknown));
        let cigar = |reference, query, simple| {
            Some(Overlap::Cigar(Cigar {
                reference,
                query,
                simple,
            }))
        };
        assert_eq!(overlap(b"55M"), cigar(55, 55, true));
        assert_eq!(overlap(b"3M2I4M2D"), cigar(9, 9, false));
        assert_eq!(overlap(b"5M2I2M"), cigar(7, 9, false));
        assert_eq!(overlap(b"M"), None);
        assert_eq!(overlap(b"5"), None);
        assert_eq!(overlap(b"5Q"), None);
        assert_eq!(overlap(b""), None);
    }
}
