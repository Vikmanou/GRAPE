//! Lossless split of a GFA, FASTG or FASTA file into a text stream, a stream
//! of sequence lengths, 2-bit bases and a side stream for what is not ACGT.
//! Joining the streams gives back the file byte for byte.
//!
//! A sequence field is the third field of an `S` line (GFA) or a whole line
//! not starting with `>` (FASTA and FASTG). It is taken out only if it holds
//! at least one A, C, G or T; otherwise (`*`, empty) it stays in the text and
//! its length is written as 0.

use super::PackError;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Mode {
    Gfa,
    Fasta,
}

#[derive(Default, Debug, PartialEq, Eq)]
pub(crate) struct Streams {
    pub text: Vec<u8>,
    /// One decimal length and a newline per sequence field.
    pub lengths: Vec<u8>,
    pub bases: Vec<u8>,
    /// Varints: runs of other bytes, then where lowercase starts and stops.
    pub side: Vec<u8>,
}

fn base(b: u8) -> Option<u8> {
    match b {
        b'A' | b'a' => Some(0),
        b'C' | b'c' => Some(1),
        b'G' | b'g' => Some(2),
        b'T' | b't' => Some(3),
        _ => None,
    }
}

pub(crate) fn mode_of(file: &[u8]) -> Mode {
    if file.first() == Some(&b'>') {
        Mode::Fasta
    } else {
        Mode::Gfa
    }
}

fn field_end(line: &[u8], from: usize, tabs_end: bool) -> usize {
    line[from..]
        .iter()
        .position(|&b| b == b'\r' || b == b'\n' || (tabs_end && b == b'\t'))
        .map_or(line.len(), |p| from + p)
}

pub(crate) fn split(file: &[u8], mode: Mode) -> Streams {
    let mut s = Streams::default();
    let mut seq = Sequences::default();
    for line in file.split_inclusive(|&b| b == b'\n') {
        let field = match mode {
            Mode::Gfa if line.starts_with(b"S\t") => line[2..]
                .iter()
                .position(|&b| b == b'\t')
                .map(|p| (3 + p, field_end(line, 3 + p, true))),
            Mode::Gfa => None,
            Mode::Fasta if line.first() == Some(&b'>') => Some((0, 0)),
            Mode::Fasta => Some((0, field_end(line, 0, false))),
        };
        let Some((start, end)) = field else {
            s.text.extend_from_slice(line);
            continue;
        };
        let body = &line[start..end];
        if body.iter().any(|&b| base(b).is_some()) {
            s.lengths
                .extend_from_slice(format!("{}\n", body.len()).as_bytes());
            seq.add(body, &mut s.bases);
            s.text.extend_from_slice(&line[..start]);
            s.text.extend_from_slice(&line[end..]);
        } else {
            s.lengths.extend_from_slice(b"0\n");
            s.text.extend_from_slice(line);
        }
    }
    s.side = seq.finish();
    s
}

/// Positions count over all sequence fields joined end to end.
#[derive(Default)]
struct Sequences {
    pos: u64,
    others: Vec<(u64, u8, u64)>,
    case_flips: Vec<u64>,
    lower: bool,
}

impl Sequences {
    fn add(&mut self, body: &[u8], bases: &mut Vec<u8>) {
        for &b in body {
            match base(b) {
                Some(x) => {
                    bases.push(x);
                    if b.is_ascii_lowercase() != self.lower {
                        self.lower = !self.lower;
                        self.case_flips.push(self.pos);
                    }
                }
                None => match self.others.last_mut() {
                    Some((at, byte, len)) if *byte == b && *at + *len == self.pos => *len += 1,
                    _ => self.others.push((self.pos, b, 1)),
                },
            }
            self.pos += 1;
        }
    }

    fn finish(self) -> Vec<u8> {
        let mut out = Vec::new();
        put(&mut out, self.others.len() as u64);
        let mut last = 0;
        for (at, byte, len) in self.others {
            put(&mut out, at - last);
            out.push(byte);
            put(&mut out, len);
            last = at + len;
        }
        put(&mut out, self.case_flips.len() as u64);
        let mut last = 0;
        for at in self.case_flips {
            put(&mut out, at - last);
            last = at;
        }
        out
    }
}

pub(crate) fn put(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

pub(crate) fn take(input: &[u8], pos: &mut usize) -> Result<u64, PackError> {
    let mut v = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *input.get(*pos).ok_or(PackError::Corrupt)?;
        *pos += 1;
        v |= u64::from(b & 0x7f) << shift;
        if b < 0x80 {
            return Ok(v);
        }
    }
    Err(PackError::Corrupt)
}

struct Side {
    others: Vec<(u64, u8, u64)>,
    flips: Vec<u64>,
}

fn read_side(side: &[u8], limit: u64) -> Result<Side, PackError> {
    let mut pos = 0;
    let n = take(side, &mut pos)?;
    let mut others = Vec::new();
    let mut last = 0u64;
    for _ in 0..n.min(limit + 1) {
        let at = last
            .checked_add(take(side, &mut pos)?)
            .ok_or(PackError::Corrupt)?;
        let byte = *side.get(pos).ok_or(PackError::Corrupt)?;
        pos += 1;
        let len = take(side, &mut pos)?;
        last = at.checked_add(len).ok_or(PackError::Corrupt)?;
        others.push((at, byte, len));
    }
    let n = take(side, &mut pos)?;
    let mut flips = Vec::new();
    let mut last = 0u64;
    for _ in 0..n.min(limit + 1) {
        last = last
            .checked_add(take(side, &mut pos)?)
            .ok_or(PackError::Corrupt)?;
        flips.push(last);
    }
    if last > limit || others.last().is_some_and(|o| o.0 + o.2 > limit) {
        return Err(PackError::Corrupt);
    }
    Ok(Side { others, flips })
}

/// Rebuilds sequence bytes in order from the bases and the side stream.
struct Rebuild<'a> {
    bases: &'a [u8],
    next_base: usize,
    side: Side,
    other: usize,
    flip: usize,
    lower: bool,
    pos: u64,
}

impl Rebuild<'_> {
    fn field(&mut self, len: u64, out: &mut Vec<u8>) -> Result<(), PackError> {
        for _ in 0..len {
            if let Some(&(at, byte, n)) = self.side.others.get(self.other)
                && self.pos >= at
            {
                out.push(byte);
                if self.pos + 1 == at + n {
                    self.other += 1;
                }
            } else {
                if self.side.flips.get(self.flip) == Some(&self.pos) {
                    self.lower = !self.lower;
                    self.flip += 1;
                }
                let x = *self.bases.get(self.next_base).ok_or(PackError::Corrupt)?;
                self.next_base += 1;
                let b = b"ACGT"[usize::from(x & 3)];
                out.push(if self.lower {
                    b.to_ascii_lowercase()
                } else {
                    b
                });
            }
            self.pos += 1;
        }
        Ok(())
    }
}

pub(crate) fn join(s: &Streams, mode: Mode, limit: usize) -> Result<Vec<u8>, PackError> {
    let mut lengths = s.lengths.split(|&b| b == b'\n');
    let mut next_len = || -> Result<u64, PackError> {
        let digits = lengths.next().ok_or(PackError::Corrupt)?;
        std::str::from_utf8(digits)
            .ok()
            .and_then(|d| d.parse().ok())
            .ok_or(PackError::Corrupt)
    };
    let mut seq = Rebuild {
        bases: &s.bases,
        next_base: 0,
        side: read_side(&s.side, limit as u64)?,
        other: 0,
        flip: 0,
        lower: false,
        pos: 0,
    };
    let mut out = Vec::with_capacity(s.text.len() + s.bases.len());
    let mut text = s.text.as_slice();
    let fasta_lines = s.lengths.iter().filter(|&&b| b == b'\n').count();
    let mut line = 0;
    while !text.is_empty() || (mode == Mode::Fasta && line < fasta_lines) {
        let rest = text
            .iter()
            .position(|&b| b == b'\n')
            .map_or(text.len(), |p| p + 1);
        let (this, after) = text.split_at(rest);
        match mode {
            Mode::Fasta => {
                let len = next_len()?;
                if len > 0 {
                    seq.field(len, &mut out)?;
                }
                out.extend_from_slice(this);
            }
            Mode::Gfa => match this
                .strip_prefix(b"S\t")
                .and_then(|r| r.iter().position(|&b| b == b'\t'))
            {
                Some(p) => {
                    out.extend_from_slice(&this[..3 + p]);
                    let len = next_len()?;
                    if len > 0 {
                        seq.field(len, &mut out)?;
                    }
                    out.extend_from_slice(&this[3 + p..]);
                }
                None => out.extend_from_slice(this),
            },
        }
        if out.len() > limit {
            return Err(PackError::Corrupt);
        }
        text = after;
        line += 1;
    }
    if seq.next_base != s.bases.len() {
        return Err(PackError::Corrupt);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(file: &[u8]) -> Streams {
        let mode = mode_of(file);
        let s = split(file, mode);
        assert_eq!(
            join(&s, mode, file.len()).unwrap(),
            file,
            "{:?}",
            String::from_utf8_lossy(file)
        );
        s
    }

    #[test]
    fn gfa_sequences_leave_the_text() {
        let s =
            round_trip(b"H\tVN:Z:1.0\nS\t1\tACGTnnNNacgT\tLN:i:12\nS\t2\t*\nL\t1\t+\t2\t-\t0M\n");
        assert_eq!(
            s.text,
            b"H\tVN:Z:1.0\nS\t1\t\tLN:i:12\nS\t2\t*\nL\t1\t+\t2\t-\t0M\n"
        );
        assert_eq!(s.lengths, b"12\n0\n");
        assert_eq!(s.bases, [0, 1, 2, 3, 0, 1, 2, 3]);
    }

    #[test]
    fn odd_files_round_trip() {
        for file in [
            &b""[..],
            b"S\t1\tACGT",
            b"S\t1\tAC\r\nS\t2\tRYKM\r\n",
            b"S\t1\n",
            b"S\t\t\t\n",
            b">a\nACGT\nacgtNNNN\n\n>b\r\nAC\r\n",
            b">only header",
            b">x\nAC",
            b"\n\n",
            b"S\tx\tAAAAnnnnaaaaNNNN\tcc\n",
        ] {
            round_trip(file);
        }
    }
}
