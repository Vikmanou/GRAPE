//! Plain files keep no sequence in memory: sequences are read back from the
//! file by offset. Gzipped files cannot be read at random, so their sequences
//! are packed 2 bits per base while streaming.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqMode {
    FileOffsets,
    /// Every sequence is dropped if packing would exceed the budget.
    Packed {
        budget_bytes: u64,
    },
}

pub const DEFAULT_BUDGET: u64 = 1 << 30;

/// Identical non-ACGT bytes, stored as A in the 2-bit array.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Run {
    pub start: u64,
    pub len: u32,
    pub byte: u8,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Packed {
    /// First base in the low bits; A=0 C=1 G=2 T=3.
    pub bits: Vec<u8>,
    pub bases: u64,
    pub runs: Vec<Run>,
    pub dropped: bool,
    budget_bytes: u64,
}

impl Packed {
    pub(crate) fn new(budget_bytes: u64) -> Self {
        Self {
            budget_bytes,
            ..Self::default()
        }
    }

    pub(crate) fn start(&self) -> u64 {
        self.bases
    }

    /// Returns `false` when this append exceeded the budget.
    pub(crate) fn append(&mut self, seq: &[u8]) -> bool {
        if self.dropped {
            return true;
        }
        let bases = self.bases + seq.len() as u64;
        if bases.div_ceil(4) > self.budget_bytes {
            self.dropped = true;
            self.bits = Vec::new();
            self.runs = Vec::new();
            return false;
        }
        self.bits.resize(bases.div_ceil(4) as usize, 0);
        for (pos, &b) in (self.bases..).zip(seq) {
            let code = CODE[b as usize];
            if code > 3 {
                self.add_run(pos, b);
            } else {
                self.bits[(pos / 4) as usize] |= code << ((pos % 4) * 2);
            }
        }
        self.bases = bases;
        true
    }

    fn add_run(&mut self, pos: u64, byte: u8) {
        if let Some(last) = self.runs.last_mut()
            && last.byte == byte
            && last.start + u64::from(last.len) == pos
            && last.len < u32::MAX
        {
            last.len += 1;
            return;
        }
        self.runs.push(Run {
            start: pos,
            len: 1,
            byte,
        });
    }

    pub fn decode(&self, start: u64, len: u64) -> Vec<u8> {
        const BASES: [u8; 4] = *b"ACGT";
        let end = start + len;
        let mut out: Vec<u8> = (start..end)
            .map(|p| BASES[(self.bits[(p / 4) as usize] >> ((p % 4) * 2) & 3) as usize])
            .collect();
        let first = self
            .runs
            .partition_point(|r| r.start + u64::from(r.len) <= start);
        for run in &self.runs[first..] {
            if run.start >= end {
                break;
            }
            let from = run.start.max(start);
            let to = (run.start + u64::from(run.len)).min(end);
            for p in from..to {
                out[(p - start) as usize] = run.byte;
            }
        }
        out
    }

    pub fn heap_bytes(&self) -> usize {
        self.bits.capacity() + self.runs.capacity() * std::mem::size_of::<Run>()
    }
}

/// 4 marks anything that is not A/C/G/T.
static CODE: [u8; 256] = {
    let mut t = [4u8; 256];
    t[b'A' as usize] = 0;
    t[b'a' as usize] = 0;
    t[b'C' as usize] = 1;
    t[b'c' as usize] = 1;
    t[b'G' as usize] = 2;
    t[b'g' as usize] = 2;
    t[b'T' as usize] = 3;
    t[b't' as usize] = 3;
    t
};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BaseCount {
    pub len: u64,
    pub acgt: u64,
    pub gc: u64,
}

impl BaseCount {
    pub(crate) fn add(&mut self, seq: &[u8]) {
        // Independent lanes so consecutive bytes do not wait on one counter;
        // this loop sees every base in the file.
        let mut acgt = [0u64; 4];
        let mut gc = [0u64; 4];
        let (chunks, rest) = seq.as_chunks::<4>();
        for c in chunks {
            for lane in 0..4 {
                let code = CODE[c[lane] as usize];
                acgt[lane] += u64::from(code < 4);
                gc[lane] += u64::from(code == 1 || code == 2);
            }
        }
        for &b in rest {
            let code = CODE[b as usize];
            acgt[0] += u64::from(code < 4);
            gc[0] += u64::from(code == 1 || code == 2);
        }
        self.len += seq.len() as u64;
        self.acgt += acgt.iter().sum::<u64>();
        self.gc += gc.iter().sum::<u64>();
    }

    pub(crate) fn gc_fraction(&self) -> f32 {
        if self.acgt == 0 {
            f32::NAN
        } else {
            (self.gc as f64 / self.acgt as f64) as f32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_and_decodes_with_runs() {
        let mut p = Packed::new(DEFAULT_BUDGET);
        assert!(p.append(b"ACGTNNac"));
        assert!(p.append(b"gtRN"));
        assert_eq!(p.decode(0, 8), b"ACGTNNAC");
        assert_eq!(p.decode(8, 4), b"GTRN");
        assert_eq!(p.decode(5, 3), b"NAC");
        assert_eq!(p.runs.len(), 3);
    }

    #[test]
    fn budget_drops_everything() {
        let mut p = Packed::new(2);
        assert!(p.append(b"ACGTACGT"));
        assert!(!p.append(b"A"));
        assert!(p.dropped);
        assert!(p.bits.is_empty());
        assert!(p.append(b"ACGT"));
    }

    #[test]
    fn gc_counts_ignore_n() {
        let mut c = BaseCount::default();
        c.add(b"GGCCAANN");
        c.add(b"t");
        assert_eq!((c.len, c.acgt, c.gc), (9, 7, 4));
        assert!((c.gc_fraction() - 4.0 / 7.0).abs() < 1e-6);
        assert!(BaseCount::default().gc_fraction().is_nan());
    }
}
