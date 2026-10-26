pub mod seg_flags {
    /// Without it the segment is a placeholder for a name only referenced.
    pub const DEFINED: u8 = 1;
    pub const HAS_SEQ: u8 = 2;
    /// FASTG sequence over several lines: reading it back must skip newlines.
    pub const SEQ_WRAPPED: u8 = 4;
    /// FASTG file with only the reverse-complement record for this segment.
    pub const SEQ_REVERSED: u8 = 8;
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
    /// File byte offset of each segment's `S` line or FASTG header, for plain
    /// input only: gzipped files cannot be read at an offset.
    pub line: Vec<u64>,
    track_lines: bool,
}

impl Segments {
    pub(crate) fn new(track_lines: bool) -> Self {
        Self {
            track_lines,
            ..Self::default()
        }
    }

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
        if self.track_lines {
            self.line.push(0);
        }
    }

    pub(crate) fn set_line(&mut self, id: u32, offset: u64) {
        if let Some(line) = self.line.get_mut(id as usize) {
            *line = offset;
        }
    }

    pub fn heap_bytes(&self) -> usize {
        self.length.capacity() * 4
            + self.depth.capacity() * 4
            + self.gc.capacity() * 4
            + self.seq.capacity() * 8
            + self.component.capacity() * 4
            + self.flags.capacity()
            + self.line.capacity() * 8
    }
}
