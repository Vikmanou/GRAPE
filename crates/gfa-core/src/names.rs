use hashbrown::{DefaultHashBuilder, HashTable};
use std::hash::BuildHasher;

/// Decimal names below this always use the dense array (4 MB at most).
const DENSE_ALWAYS: usize = 1 << 20;

/// Ids stay below 2^31 so a path step can carry orientation in the high bit.
pub const MAX_ID: u32 = (1 << 31) - 1;

/// Strings stored back to back; id `i` spans `ends[i - 1]..ends[i]`.
#[derive(Debug, Default)]
pub struct Arena {
    bytes: Vec<u8>,
    ends: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Full;

impl Arena {
    pub fn len(&self) -> usize {
        self.ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    pub fn get(&self, id: u32) -> &[u8] {
        span(&self.bytes, &self.ends, id)
    }

    pub(crate) fn push(&mut self, s: &[u8]) -> Result<u32, Full> {
        let id = u32::try_from(self.ends.len()).map_err(|_| Full)?;
        let end = u32::try_from(self.bytes.len() + s.len()).map_err(|_| Full)?;
        if id > MAX_ID {
            return Err(Full);
        }
        self.bytes.extend_from_slice(s);
        self.ends.push(end);
        Ok(id)
    }

    pub fn text_bytes(&self) -> usize {
        self.bytes.capacity()
    }

    pub fn offset_bytes(&self) -> usize {
        self.ends.capacity() * 4
    }

    pub fn heap_bytes(&self) -> usize {
        self.text_bytes() + self.offset_bytes()
    }
}

fn span<'a>(bytes: &'a [u8], ends: &[u32], id: u32) -> &'a [u8] {
    let i = id as usize;
    let Some(&end) = ends.get(i) else {
        return &[];
    };
    let start = if i == 0 { 0 } else { ends[i - 1] };
    &bytes[start as usize..end as usize]
}

/// The table holds only ids and hashes names through the arena, so each name
/// is stored once. Plain decimal names, which most assemblers and pangenome
/// tools write, skip the table: they index a dense array, one memory access
/// instead of several cache misses in a large table.
#[derive(Default)]
pub struct Names {
    pub arena: Arena,
    table: HashTable<u32>,
    hasher: DefaultHashBuilder,
    /// `numeric[n]` is the id of the name `n` plus one; 0 when absent.
    numeric: Vec<u32>,
    /// Some decimal name went to the table because it was too far past the
    /// dense array, so decimal lookups must also check the table.
    sparse_numbers: bool,
}

impl std::fmt::Debug for Names {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Names").field("len", &self.len()).finish()
    }
}

/// The value of a name written as a decimal number without leading zeros.
fn decimal(name: &[u8]) -> Option<usize> {
    match name {
        [] => None,
        [b'0'] => Some(0),
        [b'0', ..] => None,
        _ if name.len() <= 9 && name.iter().all(u8::is_ascii_digit) => {
            Some(name.iter().fold(0, |n, &d| n * 10 + usize::from(d - b'0')))
        }
        _ => None,
    }
}

impl Names {
    pub fn len(&self) -> usize {
        self.arena.len()
    }

    pub fn is_empty(&self) -> bool {
        self.arena.is_empty()
    }

    pub fn get(&self, id: u32) -> &[u8] {
        self.arena.get(id)
    }

    pub fn find(&self, name: &[u8]) -> Option<u32> {
        if let Some(n) = decimal(name) {
            if let Some(&slot) = self.numeric.get(n)
                && slot != 0
            {
                return Some(slot - 1);
            }
            if !self.sparse_numbers {
                return None;
            }
        }
        let hash = self.hasher.hash_one(name);
        let Arena { bytes, ends } = &self.arena;
        self.table
            .find(hash, |&id| span(bytes, ends, id) == name)
            .copied()
    }

    /// Returns the id and whether it was just added.
    pub(crate) fn intern(&mut self, name: &[u8]) -> Result<(u32, bool), Full> {
        if let Some(id) = self.find(name) {
            return Ok((id, false));
        }
        let id = self.arena.push(name)?;
        if let Some(n) = decimal(name) {
            // Links often name segments long before their S line, so the
            // array may run ahead of the name count, but only so far that a
            // few huge numbers cannot blow up memory.
            if n < DENSE_ALWAYS.max(16 * self.len()) {
                if n >= self.numeric.len() {
                    self.numeric.resize(n + 1, 0);
                }
                self.numeric[n] = id + 1;
                return Ok((id, true));
            }
            self.sparse_numbers = true;
        }
        let hasher = &self.hasher;
        let Arena { bytes, ends } = &self.arena;
        self.table.insert_unique(hasher.hash_one(name), id, |&id| {
            hasher.hash_one(span(bytes, ends, id))
        });
        Ok((id, true))
    }

    /// Lookup structures only; counted per segment in the memory report.
    pub fn index_bytes(&self) -> usize {
        self.table.allocation_size() + self.numeric.capacity() * 4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interns_once() {
        let mut names = Names::default();
        assert_eq!(names.intern(b"a"), Ok((0, true)));
        assert_eq!(names.intern(b"bb"), Ok((1, true)));
        assert_eq!(names.intern(b"a"), Ok((0, false)));
        assert_eq!(names.get(1), b"bb");
        assert_eq!(names.find(b"bb"), Some(1));
        assert_eq!(names.find(b"c"), None);
        assert_eq!(names.get(7), b"");
    }

    #[test]
    fn decimal_names_use_the_dense_index_and_others_the_table() {
        let mut names = Names::default();
        for name in ["0", "7", "007", "x1", "12", "999999999", "1000000000"] {
            names.intern(name.as_bytes()).unwrap();
        }
        for (id, name) in ["0", "7", "007", "x1", "12", "999999999", "1000000000"]
            .iter()
            .enumerate()
        {
            assert_eq!(names.find(name.as_bytes()), Some(id as u32), "{name}");
        }
        assert_eq!(names.find(b"8"), None);
        assert_eq!(names.find(b"07"), None);
        assert_eq!(names.intern(b"999999999"), Ok((5, false)));
        assert!(names.sparse_numbers);
        assert!(names.numeric.len() <= 1000);
    }

    #[test]
    fn many_names_survive_rehash() {
        let mut names = Names::default();
        for i in 0..10_000u32 {
            names.intern(i.to_string().as_bytes()).unwrap();
        }
        for i in 0..10_000u32 {
            assert_eq!(names.find(i.to_string().as_bytes()), Some(i));
        }
    }
}
