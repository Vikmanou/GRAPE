use crate::parse::fields::{Cigar, Overlap};
use hashbrown::{DefaultHashBuilder, HashTable};
use std::hash::BuildHasher;

pub mod link_bits {
    pub const FROM_REVERSE: u8 = 1;
    pub const TO_REVERSE: u8 = 2;
    pub const OVERLAP_UNKNOWN: u8 = 4;
    pub const OVERLAP_COMPLEX: u8 = 8;
    /// The first line seen for this link was written as its mirror.
    pub const WRITTEN_MIRRORED: u8 = 16;
    /// The mirror line gave its own overlap for its From segment.
    pub const PER_STRAND: u8 = 32;
}

/// Of a link and its mirror (`a+ b-` and `b+ a-`) only the smaller by
/// `(from, from_reverse, to, to_reverse)` is stored.
#[derive(Default)]
pub struct Links {
    pub from: Vec<u32>,
    pub to: Vec<u32>,
    pub bits: Vec<u8>,
    /// Overlap in bases on each segment; they differ only for CIGARs with
    /// indels, or for tools that measure each strand separately.
    pub overlap_from: Vec<u32>,
    pub overlap_to: Vec<u32>,
    /// Dedup index of (packed key, link index), dropped once parsing ends.
    /// Holding the key itself avoids reading the link arrays on each probe.
    table: HashTable<(u64, u32)>,
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
    /// The mirror line gave the overlap measured on its own From segment,
    /// as miniasm and hifiasm write it; that side was updated.
    PerStrand,
    /// Same link in the same direction with a different overlap; the first
    /// is kept.
    Conflict,
}

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
        let key = u64::from(from) << 32 | u64::from(to);

        // The CIGAR's reference is the line's From segment; mirroring makes
        // that the canonical To side.
        let (sides, mut bits) = match overlap {
            Overlap::Unknown => ((0, 0), link_bits::OVERLAP_UNKNOWN),
            Overlap::Cigar(Cigar {
                reference,
                query,
                simple,
            }) => (
                if mirrored {
                    (query, reference)
                } else {
                    (reference, query)
                },
                if simple {
                    0
                } else {
                    link_bits::OVERLAP_COMPLEX
                },
            ),
        };
        if from & 1 == 1 {
            bits |= link_bits::FROM_REVERSE;
        }
        if to & 1 == 1 {
            bits |= link_bits::TO_REVERSE;
        }

        let hash = self.hasher.hash_one(key);
        if let Some(&(_, i)) = self.table.find(hash, |&(k, _)| k == key) {
            return self.repeat(i as usize, sides, bits, mirrored, overlap);
        }

        let index = self.from.len() as u32;
        self.from.push(from >> 1);
        self.to.push(to >> 1);
        self.bits.push(
            bits | if mirrored {
                link_bits::WRITTEN_MIRRORED
            } else {
                0
            },
        );
        self.overlap_from.push(sides.0);
        self.overlap_to.push(sides.1);
        let hasher = &self.hasher;
        self.table
            .insert_unique(hash, (key, index), |&(k, _)| hasher.hash_one(k));
        LinkInsert::New
    }

    fn repeat(
        &mut self,
        i: usize,
        sides: (u32, u32),
        bits: u8,
        mirrored: bool,
        overlap: Overlap,
    ) -> LinkInsert {
        use link_bits::{OVERLAP_COMPLEX, OVERLAP_UNKNOWN, PER_STRAND, WRITTEN_MIRRORED};
        let stored = self.bits[i];
        if (stored ^ bits) & OVERLAP_UNKNOWN != 0 {
            return LinkInsert::Conflict;
        }
        if bits & OVERLAP_UNKNOWN != 0 || (self.overlap_from[i], self.overlap_to[i]) == sides {
            return LinkInsert::Duplicate;
        }
        let Overlap::Cigar(c) = overlap else {
            return LinkInsert::Conflict;
        };
        if (stored | bits) & OVERLAP_COMPLEX != 0 {
            return LinkInsert::Conflict;
        }
        // A simple `nM` line measures the overlap on its own From segment.
        let own = if mirrored {
            &mut self.overlap_to[i]
        } else {
            &mut self.overlap_from[i]
        };
        if *own == c.reference {
            return LinkInsert::Duplicate;
        }
        let other_strand = (stored & WRITTEN_MIRRORED != 0) != mirrored;
        if other_strand && stored & PER_STRAND == 0 {
            *own = c.reference;
            self.bits[i] |= PER_STRAND;
            return LinkInsert::PerStrand;
        }
        LinkInsert::Conflict
    }

    pub(crate) fn seal(&mut self) {
        self.table = HashTable::new();
    }

    pub fn heap_bytes(&self) -> usize {
        self.from.capacity() * 4
            + self.to.capacity() * 4
            + self.bits.capacity()
            + self.overlap_from.capacity() * 4
            + self.overlap_to.capacity() * 4
            + self.table.allocation_size()
    }
}

/// Ids are below 2^31, so an end fits in 32 bits.
fn end_key(segment: u32, reverse: bool) -> u32 {
    segment << 1 | u32::from(reverse)
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
            links.insert((1, false), (0, true), cigar(5)),
            LinkInsert::Duplicate
        );
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn same_direction_with_another_overlap_conflicts() {
        let mut links = Links::default();
        links.insert((0, false), (1, false), cigar(5));
        assert_eq!(
            links.insert((0, false), (1, false), cigar(4)),
            LinkInsert::Conflict
        );
        assert_eq!(
            links.insert((0, false), (1, false), Overlap::Unknown),
            LinkInsert::Conflict
        );
        assert_eq!((links.overlap_from[0], links.overlap_to[0]), (5, 5));
    }

    #[test]
    fn mirror_with_another_overlap_sets_its_own_side() {
        // miniasm: `L a+ b+ 100M` then `L b- a- 90M`, each measured on its From read.
        let mut links = Links::default();
        links.insert((0, false), (1, false), cigar(100));
        assert_eq!(
            links.insert((1, true), (0, true), cigar(90)),
            LinkInsert::PerStrand
        );
        assert_eq!((links.overlap_from[0], links.overlap_to[0]), (100, 90));
        assert_eq!(
            links.insert((1, true), (0, true), cigar(90)),
            LinkInsert::Duplicate
        );
        assert_eq!(
            links.insert((0, false), (1, false), cigar(100)),
            LinkInsert::Duplicate
        );
        assert_eq!(
            links.insert((1, true), (0, true), cigar(80)),
            LinkInsert::Conflict
        );
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
    fn mirrored_complex_cigar_swaps_sides() {
        let mut links = Links::default();
        let overlap = Overlap::Cigar(Cigar {
            reference: 7,
            query: 9,
            simple: false,
        });
        links.insert((1, false), (0, false), overlap);
        assert_eq!((links.overlap_from[0], links.overlap_to[0]), (9, 7));
        assert_ne!(links.bits[0] & link_bits::OVERLAP_COMPLEX, 0);
    }
}
