use crate::store::names::{Arena, Full};

/// Step bit for the reverse orientation.
pub const REVERSE: u32 = 1 << 31;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    Path,
    Walk,
}

#[derive(Debug, Default)]
pub struct Paths {
    /// Walks are named `sample#hap#seqid[:start-end]`.
    pub names: Arena,
    pub kind: Vec<PathKind>,
    pub step_ends: Vec<u64>,
    pub steps: Vec<u32>,
}

impl Paths {
    pub fn len(&self) -> usize {
        self.kind.len()
    }

    pub fn is_empty(&self) -> bool {
        self.kind.is_empty()
    }

    pub fn steps(&self, i: usize) -> &[u32] {
        let end = self.step_ends[i] as usize;
        let start = if i == 0 {
            0
        } else {
            self.step_ends[i - 1] as usize
        };
        &self.steps[start..end]
    }

    pub fn count(&self, kind: PathKind) -> usize {
        self.kind.iter().filter(|&&k| k == kind).count()
    }

    /// Commits the steps pushed since the last path.
    pub(crate) fn finish_path(&mut self, name: &[u8], kind: PathKind) -> Result<(), Full> {
        self.names.push(name)?;
        self.kind.push(kind);
        self.step_ends.push(self.steps.len() as u64);
        Ok(())
    }

    pub(crate) fn discard_pending(&mut self) {
        let committed = self.step_ends.last().copied().unwrap_or(0) as usize;
        self.steps.truncate(committed);
    }

    pub fn heap_bytes(&self) -> usize {
        self.names.heap_bytes()
            + self.kind.capacity()
            + self.step_ends.capacity() * 8
            + self.steps.capacity() * 4
    }
}

/// `>s1<s2>s3` into `(name, reverse)` steps.
pub(crate) fn walk_steps(walk: &[u8]) -> Option<Vec<(&[u8], bool)>> {
    let mut steps = Vec::new();
    let mut rest = walk;
    while let Some((&dir, tail)) = rest.split_first() {
        let reverse = match dir {
            b'>' => false,
            b'<' => true,
            _ => return None,
        };
        let len = tail
            .iter()
            .position(|&b| b == b'>' || b == b'<')
            .unwrap_or(tail.len());
        if len == 0 {
            return None;
        }
        steps.push((&tail[..len], reverse));
        rest = &tail[len..];
    }
    if steps.is_empty() { None } else { Some(steps) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks() {
        let steps = walk_steps(b">s1<s2>s3").unwrap();
        assert_eq!(
            steps,
            vec![(&b"s1"[..], false), (&b"s2"[..], true), (&b"s3"[..], false)]
        );
        assert!(walk_steps(b"s1>s2").is_none());
        assert!(walk_steps(b">").is_none());
        assert!(walk_steps(b"").is_none());
    }
}
