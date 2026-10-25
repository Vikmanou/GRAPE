/// Plain arrays, so a worker can build one from what it received.
#[derive(Debug, Clone, Copy)]
pub struct Topology<'a> {
    pub lengths: &'a [u32],
    /// Component rank per segment.
    pub components: &'a [u32],
    pub link_from: &'a [u32],
    pub link_to: &'a [u32],
    pub link_bits: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopologyError {
    LengthMismatch,
    BadSegment,
    BadComponent,
}

impl std::fmt::Display for TopologyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::LengthMismatch => "layout arrays have different lengths",
            Self::BadSegment => "a link names a segment that does not exist",
            Self::BadComponent => "component ranks are not 0 to n - 1",
        })
    }
}

impl std::error::Error for TopologyError {}

impl Topology<'_> {
    pub(crate) fn component_count(&self) -> usize {
        self.components.iter().max().map_or(0, |&c| c as usize + 1)
    }

    pub(crate) fn validate(&self) -> Result<(), TopologyError> {
        let n = self.lengths.len();
        let links = self.link_from.len();
        if self.components.len() != n
            || self.link_to.len() != links
            || self.link_bits.len() != links
        {
            return Err(TopologyError::LengthMismatch);
        }
        let ok = |&s: &u32| (s as usize) < n;
        if !self.link_from.iter().all(ok) || !self.link_to.iter().all(ok) {
            return Err(TopologyError::BadSegment);
        }
        let mut seen = vec![false; self.component_count()];
        for &c in self.components {
            seen[c as usize] = true;
        }
        if seen.contains(&false) {
            return Err(TopologyError::BadComponent);
        }
        Ok(())
    }
}
