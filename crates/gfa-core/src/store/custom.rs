/// Bandage's custom tags, kept only for the segments that have them, in
/// segment order.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CustomTags {
    /// CL: the segment's colour, RGBA8 with red in the low byte.
    pub color: Vec<(u32, u32)>,
    /// C2: its reverse complement's colour.
    pub color2: Vec<(u32, u32)>,
    /// LB: the segment's label.
    pub label: Vec<(u32, String)>,
    /// L2: its reverse complement's label.
    pub label2: Vec<(u32, String)>,
}

impl CustomTags {
    pub(crate) fn seal(&mut self) {
        self.color.sort_by_key(|e| e.0);
        self.color2.sort_by_key(|e| e.0);
        self.label.sort_by_key(|e| e.0);
        self.label2.sort_by_key(|e| e.0);
    }

    pub fn is_empty(&self) -> bool {
        self.color.is_empty()
            && self.color2.is_empty()
            && self.label.is_empty()
            && self.label2.is_empty()
    }
}
