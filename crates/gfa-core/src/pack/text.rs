//! Context-mixing model for the text left once sequences are taken out:
//! names, links, tags, paths. Bytes are coded high bit first, as in lpaq1.
//! Besides the usual order-n and word contexts, GFA is a table, so three
//! contexts look at the same column of the previous line of the same record
//! type, where names count up and tags repeat.

use super::coder::{Apm, BitIo, COUNTER_START, Mixer, counter_p, counter_update, stretch};

const CONTEXTS: usize = 10;
const INPUTS: usize = CONTEXTS + 2;
const MATCH_MIN: usize = 6;
const MAX_FIELDS: usize = 16;

fn mix32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^ (x >> 16)
}

fn hash(i: u32, a: u32, b: u32) -> u32 {
    mix32(a.wrapping_mul(0x9E37_79B1) ^ mix32(b ^ i.wrapping_mul(0x85EB_CA6B)))
}

/// The previous line of one record type, as field start offsets into its bytes.
#[derive(Default)]
struct Line {
    bytes: Vec<u8>,
    fields: Vec<usize>,
}

impl Line {
    fn at(&self, field: usize, offset: usize) -> u8 {
        let Some(&start) = self.fields.get(field) else {
            return 0;
        };
        let end = self
            .fields
            .get(field + 1)
            .map_or(self.bytes.len(), |&s| s - 1);
        if start + offset < end {
            self.bytes[start + offset]
        } else {
            0
        }
    }
}

fn record_type(first: u8) -> usize {
    match first {
        b'S' => 1,
        b'L' => 2,
        b'P' => 3,
        b'W' => 4,
        b'H' => 5,
        b'C' => 6,
        b'>' => 7,
        _ => 0,
    }
}

pub(crate) struct TextModel {
    tables: Vec<Vec<u32>>,
    bits: u32,
    hashes: [u32; CONTEXTS],
    slots: [usize; CONTEXTS],
    c0: u32,
    c4: u32,
    c8: u32,
    word: u32,
    line: Line,
    prev: Vec<Line>,
    kind: usize,
    hist: Vec<u8>,
    starts: Vec<u32>,
    match_ptr: usize,
    match_len: usize,
    match_counters: Vec<u32>,
    mixer: Mixer,
    apm1: Apm,
    apm2: Apm,
}

impl TextModel {
    pub(crate) fn new(expected: usize) -> Self {
        let bits = (usize::BITS - expected.max(1).leading_zeros() + 3).clamp(12, 20);
        let mut m = Self {
            tables: (0..CONTEXTS)
                .map(|_| vec![COUNTER_START; 1 << bits])
                .collect(),
            bits,
            hashes: [0; CONTEXTS],
            slots: [0; CONTEXTS],
            c0: 1,
            c4: 0,
            c8: 0,
            word: 0,
            line: Line {
                bytes: Vec::new(),
                fields: vec![0],
            },
            prev: (0..8).map(|_| Line::default()).collect(),
            kind: 0,
            hist: Vec::with_capacity(expected.min(1 << 24)),
            starts: vec![0; 1 << bits.min(18)],
            match_ptr: 0,
            match_len: 0,
            match_counters: vec![COUNTER_START; 64],
            mixer: Mixer::new(INPUTS, 256, 3),
            apm1: Apm::new(256),
            apm2: Apm::new(1 << 16),
        };
        m.set_contexts();
        m
    }

    fn set_contexts(&mut self) {
        let c4 = self.c4;
        let field = self.line.fields.len() - 1;
        let offset = self.line.bytes.len() - self.line.fields[field];
        let above = u32::from(self.prev[self.kind].at(field, offset));
        let column = (self.kind as u32) << 8 | field as u32;
        self.hashes = [
            0,
            hash(1, c4 & 0xff, 0),
            hash(2, c4 & 0xffff, 0),
            hash(3, c4 & 0x00ff_ffff, 0),
            hash(4, c4, 0),
            hash(5, c4, self.c8 & 0xffff),
            hash(6, self.word, c4 & 0xff),
            hash(7, column, above),
            hash(8, column << 8 | above, c4 & 0xff),
            hash(9, column, offset.min(255) as u32),
        ];
    }

    fn match_bit(&self) -> Option<bool> {
        if self.match_len == 0 {
            return None;
        }
        let pred = u32::from(self.hist[self.match_ptr]) | 256;
        let shown = 32 - self.c0.leading_zeros() - 1;
        (pred >> (8 - shown) == self.c0).then(|| (pred >> (7 - shown)) & 1 != 0)
    }

    fn predict(&mut self) -> u32 {
        let c0 = self.c0;
        for i in 0..CONTEXTS {
            let slot =
                (mix32(self.hashes[i] ^ c0.wrapping_mul(0x9E37_79B1)) >> (32 - self.bits)) as usize;
            self.slots[i] = slot;
            self.mixer.add(stretch(counter_p(self.tables[i][slot])));
        }
        let input = match self.match_bit() {
            Some(e) => {
                let p = stretch(counter_p(self.match_counters[self.match_len.min(63)]));
                if e { p } else { -p }
            }
            None => 0,
        };
        self.mixer.add(input);
        self.mixer.add(256);
        let pr = self.mixer.mix(c0 as usize);
        let a1 = self.apm1.refine(pr, c0 as usize);
        let a2 = self.apm2.refine(pr, (c0 | (self.c4 & 0xff) << 8) as usize);
        (2 * pr + a1 + a2) / 4
    }

    fn update(&mut self, bit: bool) {
        if let Some(e) = self.match_bit() {
            counter_update(
                &mut self.match_counters[self.match_len.min(63)],
                bit == e,
                1023,
            );
        }
        self.mixer.update(bit);
        self.apm1.update(bit);
        self.apm2.update(bit);
        for i in 0..CONTEXTS {
            counter_update(&mut self.tables[i][self.slots[i]], bit, 255);
        }
        self.c0 = (self.c0 << 1) | u32::from(bit);
    }

    pub(crate) fn code(&mut self, io: &mut impl BitIo, byte: u8) -> u8 {
        for i in (0..8).rev() {
            let p = self.predict();
            let bit = io.bit(p, (byte >> i) & 1 != 0);
            self.update(bit);
        }
        let c = (self.c0 & 0xff) as u8;
        self.c0 = 1;
        self.push(c);
        c
    }

    fn push(&mut self, c: u8) {
        self.c8 = (self.c8 << 8) | (self.c4 >> 24);
        self.c4 = (self.c4 << 8) | u32::from(c);
        self.word = if c.is_ascii_alphanumeric() {
            (self.word ^ u32::from(c)).wrapping_mul(0x0100_0193)
        } else {
            0
        };
        self.follow_line(c);
        self.follow_match(c);
        self.set_contexts();
    }

    fn follow_line(&mut self, c: u8) {
        if c == b'\n' {
            let done = std::mem::replace(
                &mut self.line,
                Line {
                    bytes: Vec::new(),
                    fields: vec![0],
                },
            );
            self.prev[self.kind] = done;
            self.kind = 0;
            return;
        }
        if self.line.bytes.is_empty() {
            self.kind = record_type(c);
        }
        self.line.bytes.push(c);
        if c == b'\t' && self.line.fields.len() < MAX_FIELDS {
            self.line.fields.push(self.line.bytes.len());
        }
    }

    fn follow_match(&mut self, c: u8) {
        if self.match_len > 0 {
            if self.hist[self.match_ptr] == c {
                self.match_len += 1;
                self.match_ptr += 1;
            } else {
                self.match_len = 0;
            }
        }
        self.hist.push(c);
        let n = self.hist.len();
        if n < MATCH_MIN {
            return;
        }
        let key = self.hist[n - MATCH_MIN..]
            .iter()
            .fold(0u32, |h, &b| (h ^ u32::from(b)).wrapping_mul(0x0100_0193));
        let at = (mix32(key) >> (32 - self.bits.min(18))) as usize;
        if self.match_len == 0 {
            let cand = self.starts[at] as usize;
            if cand > 0 {
                let len = (1..=cand.min(32))
                    .take_while(|&i| self.hist[cand - i] == self.hist[n - i])
                    .count();
                if len >= MATCH_MIN {
                    self.match_ptr = cand;
                    self.match_len = len;
                }
            }
        }
        self.starts[at] = n as u32;
    }
}

#[cfg(test)]
mod tests {
    use super::super::coder::{Decoder, Encoder};
    use super::*;

    fn round_trip(text: &[u8]) -> usize {
        let mut e = Encoder::new();
        let mut m = TextModel::new(text.len());
        for &b in text {
            m.code(&mut e, b);
        }
        let data = e.finish();
        let mut d = Decoder::new(&data);
        let mut m = TextModel::new(text.len());
        let back: Vec<u8> = (0..text.len()).map(|_| m.code(&mut d, 0)).collect();
        assert_eq!(back, text);
        data.len()
    }

    #[test]
    fn link_lines_compress_well() {
        let text: String = (1..2000)
            .map(|i| format!("L\t{i}\t+\t{}\t-\t55M\n", i + 1))
            .collect();
        let bytes = round_trip(text.as_bytes());
        assert!(bytes * 12 < text.len(), "{bytes} of {}", text.len());
    }

    #[test]
    fn arbitrary_bytes_round_trip() {
        let bytes: Vec<u8> = (0..3000u32)
            .map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8)
            .collect();
        round_trip(&bytes);
        round_trip(b"");
        round_trip(b"\n\t\n");
    }
}
