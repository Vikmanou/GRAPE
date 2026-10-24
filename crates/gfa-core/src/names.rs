use hashbrown::{DefaultHashBuilder, HashTable};
use std::hash::BuildHasher;

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
/// is stored once.
#[derive(Default)]
pub struct Names {
    pub arena: Arena,
    table: HashTable<u32>,
    hasher: DefaultHashBuilder,
}

impl std::fmt::Debug for Names {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Names").field("len", &self.len()).finish()
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
        let hasher = &self.hasher;
        let Arena { bytes, ends } = &self.arena;
        self.table.insert_unique(hasher.hash_one(name), id, |&id| {
            hasher.hash_one(span(bytes, ends, id))
        });
        Ok((id, true))
    }

    pub fn table_bytes(&self) -> usize {
        self.table.allocation_size()
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
