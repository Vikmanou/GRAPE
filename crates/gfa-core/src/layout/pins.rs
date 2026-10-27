//! Pinning and refinement on level 0, as the GPU layout does them: a point
//! with step size 0 never moves, so pins and "re-layout selection" only
//! rewrite step sizes, and a refinement runs the second half of level 0's
//! cooling schedule again.

use super::Layout;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refining {
    No,
    /// Everything but the pinned segments moves.
    Pinned,
    /// Only the selected, unpinned segments move.
    Selection,
}

/// One bit per segment.
pub(crate) fn bit(bits: &[u32], segment: u32) -> bool {
    bits.get(segment as usize / 32)
        .is_some_and(|w| w >> (segment % 32) & 1 == 1)
}

impl Layout {
    pub fn level(&self) -> usize {
        self.level
    }

    pub fn at_level_zero(&self) -> bool {
        self.level == 0 && self.points() > 0
    }

    pub fn pinned(&self) -> usize {
        self.pin_count
    }

    pub fn refining(&self) -> bool {
        self.refining != Refining::No
    }

    /// Moves a segment by `dx, dy` and pins it; the rest follows in a
    /// refinement. Returns false before level 0, when nothing moves.
    pub fn drag(&mut self, segment: u32, dx: f32, dy: f32) -> bool {
        if !self.at_level_zero() || segment as usize >= self.chains.start.len() {
            return false;
        }
        let word = &mut self.pins[segment as usize / 32];
        if *word >> (segment % 32) & 1 == 0 {
            *word |= 1 << (segment % 32);
            self.pin_count += 1;
        }
        for p in self.chains.first(segment)..=self.chains.last(segment) {
            self.xs[p as usize] += dx;
            self.ys[p as usize] += dy;
        }
        self.set_mobility(None);
        self.refine_again(Refining::Pinned);
        true
    }

    pub fn unpin_all(&mut self) {
        self.pins.fill(0);
        self.pin_count = 0;
        if self.at_level_zero() && self.refining != Refining::Selection {
            self.set_mobility(None);
        }
    }

    /// Refines level 0 again, moving only the segments whose bit is set in
    /// `selected` when given. Returns false before level 0.
    pub fn refine(&mut self, selected: Option<&[u32]>) -> bool {
        if !self.at_level_zero() {
            return false;
        }
        self.set_mobility(selected);
        let mode = if selected.is_some() {
            Refining::Selection
        } else {
            Refining::Pinned
        };
        self.refine_again(mode);
        true
    }

    fn refine_again(&mut self, mode: Refining) {
        if self.packed.is_none() {
            self.packed = Some(self.pack_shift());
        }
        self.level_iteration = self.budget(0) / 2;
        self.refining = mode;
    }

    /// Called once a refinement has run its iterations: after a selection's
    /// refinement every unpinned point may move again.
    pub(crate) fn end_refining(&mut self) {
        if self.refining == Refining::Selection {
            self.set_mobility(None);
        }
        self.refining = Refining::No;
    }

    /// Step sizes on level 0: the hierarchy's, or 0 for points that must
    /// stay where they are.
    pub(crate) fn set_mobility(&mut self, selected: Option<&[u32]>) {
        let mut step = self.levels[0].step_sizes();
        for s in 0..self.chains.start.len() as u32 {
            let movable = !bit(&self.pins, s) && selected.is_none_or(|bits| bit(bits, s));
            if !movable {
                for p in self.chains.first(s)..=self.chains.last(s) {
                    step[p as usize] = 0.0;
                }
            }
        }
        self.forces.step = step;
    }
}
