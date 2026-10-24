use crate::fields::{Cigar, Overlap};
use hashbrown::{DefaultHashBuilder, HashTable};
use std::hash::BuildHasher;

pub mod seg_flags {
    /// Without it the segment is a placeholder for a name only referenced.
    pub const DEFINED: u8 = 1;
    pub const HAS_SEQ: u8 = 2;
    /// FASTG sequence over several lines: reading it back must skip newlines.
    pub const SEQ_WRAPPED: u8 = 4;
    /// FASTG file with only the reverse-complement record for this segment.
    pub const SEQ_REVERSED: u8 = 8;
}

pub mod link_bits {
    pub const FROM_REVERSE: u8 = 1;
    pub const TO_REVERSE: u8 = 2;
    pub const OVERLAP_UNKNOWN: u8 = 4;
    pub const OVERLAP_COMPLEX: u8 = 8;
}

pub const NO_SEQ: u64 = u64::MAX;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Segments {
    pub length: Vec<u32>,
    pub depth: Vec<f32>,
    pub gc: Vec<f32>,
    /// File byte offset for plain input, packed base offset for gzipped input.
    pub seq: Vec<u64>,
    /// Component rank, largest total length first.
    pub component: Vec<u32>,
    pub flags: Vec<u8>,
}

impl Segments {
    pub fn len(&self) -> usize {
        self.length.len()
    }

    pub fn is_empty(&self) -> bool {
        self.length.is_empty()
    }

    pub fn is_defined(&self, id: u32) -> bool {
        self.flags[id as usize] & seg_flags::DEFINED != 0
    }

    pub(crate) fn push_placeholder(&mut self) {
        self.length.push(0);
        self.depth.push(f32::NAN);
        self.gc.push(f32::NAN);
        self.seq.push(NO_SEQ);
        self.component.push(0);
        self.flags.push(0);
    }

    pub fn heap_bytes(&self) -> usize {
        self.length.capacity() * 4
            + self.depth.capacity() * 4
            + self.gc.capacity() * 4
            + self.seq.capacity() * 8
            + self.component.capacity() * 4
            + self.flags.capacity()
    }
}

/// Of a link and its mirror (`a+ b-` and `b+ a-`) only the smaller by
/// `(from, from_reverse, to, to_reverse)` is stored.
#[derive(Default)]
pub struct Links {
    pub from: Vec<u32>,
    pub to: Vec<u32>,
    pub bits: Vec<u8>,
    /// Bases on the From segment.
    pub overlap: Vec<u32>,
    /// Dedup index, dropped once parsing ends.
    table: HashTable<u32>,
    hasher: DefaultHashBuilder,
}

impl std::fmt::Debug for Links {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Links").field("len", &self.len()).finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LinkInsert {
    New,
    Duplicate,
    /// Same link or its mirror with a different overlap; the first is kept.
    Conflict,
}

type Key = (u32, u32, u8);

impl Links {
    pub fn len(&self) -> usize {
        self.from.len()
    }

    pub fn is_empty(&self) -> bool {
        self.from.is_empty()
    }

    pub fn from_reverse(&self, i: usize) -> bool {
        self.bits[i] & link_bits::FROM_REVERSE != 0
    }

    pub fn to_reverse(&self, i: usize) -> bool {
        self.bits[i] & link_bits::TO_REVERSE != 0
    }

    pub(crate) fn insert(
        &mut self,
        (a, a_rev): (u32, bool),
        (b, b_rev): (u32, bool),
        overlap: Overlap,
    ) -> LinkInsert {
        let given = (end_key(a, a_rev), end_key(b, b_rev));
        let mirror = (end_key(b, !b_rev), end_key(a, !a_rev));
        let mirrored = mirror < given;
        let (from, to) = if mirrored { mirror } else { given };
        let key: Key = (
            (from >> 1) as u32,
            (to >> 1) as u32,
            (from & 1) as u8 | ((to & 1) as u8) << 1,
        );

        let (value, mut bits) = match overlap {
            Overlap::Unknown => (0, link_bits::OVERLAP_UNKNOWN),
            // Mirroring swaps the CIGAR's reference and query, so the From
            // side's length is then the query's.
            Overlap::Cigar(Cigar {
                reference,
                query,
                simple,
            }) => (
                if mirrored { query } else { reference },
                if simple {
                    0
                } else {
                    link_bits::OVERLAP_COMPLEX
                },
            ),
        };
        bits |= key.2;

        let hash = self.hasher.hash_one(key);
        let (froms, tos, all_bits) = (&self.from, &self.to, &self.bits);
        let found = self.table.find(hash, |&i| {
            let i = i as usize;
            (froms[i], tos[i], all_bits[i] & 3) == key
        });
        if let Some(&i) = found {
            let i = i as usize;
            let same =
                self.overlap[i] == value && (self.bits[i] ^ bits) & link_bits::OVERLAP_UNKNOWN == 0;
            return if same {
                LinkInsert::Duplicate
            } else {
                LinkInsert::Conflict
            };
        }

        let index = self.from.len() as u32;
        self.from.push(key.0);
        self.to.push(key.1);
        self.bits.push(bits);
        self.overlap.push(value);
        let (hasher, froms, tos, all_bits) = (&self.hasher, &self.from, &self.to, &self.bits);
        self.table.insert_unique(hash, index, |&i| {
            let i = i as usize;
            hasher.hash_one((froms[i], tos[i], all_bits[i] & 3))
        });
        LinkInsert::New
    }

    pub(crate) fn seal(&mut self) {
        self.table = HashTable::new();
    }

    pub fn heap_bytes(&self) -> usize {
        self.from.capacity() * 4
            + self.to.capacity() * 4
            + self.bits.capacity()
            + self.overlap.capacity() * 4
            + self.table.allocation_size()
    }
}

fn end_key(segment: u32, reverse: bool) -> u64 {
    u64::from(segment) << 1 | u64::from(reverse)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cigar(n: u32) -> Overlap {
        Overlap::Cigar(Cigar {
            reference: n,
            query: n,
            simple: true,
        })
    }

    #[test]
    fn mirror_is_deduplicated() {
        let mut links = Links::default();
        assert_eq!(
            links.insert((1, false), (0, true), cigar(5)),
            LinkInsert::New
        );
        assert_eq!((links.from[0], links.to[0], links.bits[0] & 3), (0, 1, 2));
        assert_eq!(
            links.insert((0, false), (1, true), cigar(5)),
            LinkInsert::Duplicate
        );
        assert_eq!(
            links.insert((0, false), (1, true), cigar(4)),
            LinkInsert::Conflict
        );
        assert_eq!(
            links.insert((0, false), (1, true), Overlap::Unknown),
            LinkInsert::Conflict
        );
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn palindrome_is_its_own_mirror() {
        let mut links = Links::default();
        assert_eq!(
            links.insert((3, false), (3, true), cigar(0)),
            LinkInsert::New
        );
        assert_eq!(
            links.insert((3, false), (3, true), cigar(0)),
            LinkInsert::Duplicate
        );
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn mirrored_complex_cigar_stores_the_query_side() {
        let mut links = Links::default();
        let overlap = Overlap::Cigar(Cigar {
            reference: 7,
            query: 9,
            simple: false,
        });
        links.insert((1, false), (0, false), overlap);
        assert_eq!(links.overlap[0], 9);
        assert_ne!(links.bits[0] & link_bits::OVERLAP_COMPLEX, 0);
    }
}
