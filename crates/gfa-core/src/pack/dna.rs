//! Context-mixing model for DNA as 2-bit bases (A, C, G, T = 0..3), each coded
//! as two binary decisions. Order-k contexts follow the finite-context models
//! of GeCo (Pratas et al. 2016, doi:10.1109/DCC.2016.60), including their
//! inverted repeats: after each base, high orders also learn the reverse
//! complement, since an assembly graph holds both strands of its repeats.
//! Two match models predict from the longest earlier copy, forward and
//! reverse complement.

use super::coder::{Apm, BitIo, COUNTER_START, Mixer, counter_p, counter_update, stretch};

const ORDERS: [u32; 13] = [1, 2, 3, 4, 6, 8, 11, 12, 14, 16, 18, 20, 24];
/// Orders from this one up are hashed and learn inverted repeats.
const HASHED_FROM: usize = 6;
const MATCH_MIN: u32 = 20;
const INPUTS: usize = ORDERS.len() + 3;

struct Match {
    ptr: usize,
    len: u32,
}

impl Match {
    fn bucket(&self) -> usize {
        match self.len {
            0 => 0,
            l if l < 32 => (l / 2) as usize,
            l => 16 + ((l - 32) / 16).min(15) as usize,
        }
    }
}

pub(crate) struct DnaModel {
    tables: Vec<Vec<u32>>,
    hash_bits: u32,
    ctx: [usize; ORDERS.len()],
    hist: u64,
    rc_hist: u64,
    bases: Vec<u8>,
    starts: Vec<u32>,
    fwd: Match,
    rc: Match,
    fwd_pred: Option<u8>,
    rc_pred: Option<u8>,
    match_counters: Vec<u32>,
    mixer: Mixer,
    apm: Apm,
}

const fn mask(bases: u32) -> u64 {
    if bases >= 32 {
        u64::MAX
    } else {
        (1u64 << (2 * bases)) - 1
    }
}

fn hash(key: u64, salt: u32, bits: u32) -> usize {
    let h = (key ^ u64::from(salt).wrapping_mul(0xD6E8_FEB8_6659_FD93))
        .wrapping_mul(0x9E37_79B9_7F4A_7C15);
    (h >> (64 - bits)) as usize
}

impl DnaModel {
    /// Tables grow with the input, so a short link stays light on memory.
    pub(crate) fn new(expected: usize) -> Self {
        let hash_bits = (usize::BITS - expected.max(1).leading_zeros() + 1).clamp(12, 20);
        let tables = ORDERS
            .iter()
            .enumerate()
            .map(|(i, &k)| {
                let len = if i < HASHED_FROM {
                    4usize << (2 * k)
                } else {
                    4 << hash_bits
                };
                vec![COUNTER_START; len]
            })
            .collect();
        let mut m = Self {
            tables,
            hash_bits,
            ctx: [0; ORDERS.len()],
            hist: 0,
            rc_hist: 0,
            bases: Vec::with_capacity(expected.min(1 << 24)),
            starts: vec![0; 1 << hash_bits],
            fwd: Match { ptr: 0, len: 0 },
            rc: Match { ptr: 0, len: 0 },
            fwd_pred: None,
            rc_pred: None,
            match_counters: vec![COUNTER_START; 2 * 2 * 32],
            mixer: Mixer::new(INPUTS, 3 * 4, 2),
            apm: Apm::new(64 * 4),
        };
        m.set_contexts();
        m
    }

    fn slot(&self, i: usize, key: u64) -> usize {
        if i < HASHED_FROM {
            (key as usize) << 2
        } else {
            hash(key, ORDERS[i], self.hash_bits) << 2
        }
    }

    fn set_contexts(&mut self) {
        for (i, &k) in ORDERS.iter().enumerate() {
            self.ctx[i] = self.slot(i, self.hist & mask(k));
        }
        self.fwd_pred = (self.fwd.len > 0).then(|| self.bases[self.fwd.ptr]);
        self.rc_pred = (self.rc.len > 0).then(|| 3 - self.bases[self.rc.ptr]);
    }

    fn predict(&mut self, node: usize, hi: Option<bool>) -> u32 {
        for (i, t) in self.tables.iter().enumerate() {
            self.mixer.add(stretch(counter_p(t[self.ctx[i] + node])));
        }
        for (m, (pred, len)) in [(self.fwd_pred, &self.fwd), (self.rc_pred, &self.rc)]
            .into_iter()
            .enumerate()
        {
            let input = match expected(pred, hi) {
                Some(e) => {
                    let p = stretch(counter_p(
                        self.match_counters[self.match_slot(m, node, len)],
                    ));
                    if e { p } else { -p }
                }
                None => 0,
            };
            self.mixer.add(input);
        }
        self.mixer.add(256);
        let longest = self.fwd.bucket().max(self.rc.bucket());
        let set = (node - 1) * 4
            + [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3][longest.min(19)];
        let pr = self.mixer.mix(set);
        let refined = self.apm.refine(pr, ((self.hist & 63) as usize) * 4 + node);
        (pr + 3 * refined) / 4
    }

    fn match_slot(&self, m: usize, node: usize, len: &Match) -> usize {
        (m * 2 + usize::from(node > 1)) * 32 + len.bucket()
    }

    fn update(&mut self, node: usize, hi: Option<bool>, bit: bool) {
        self.mixer.update(bit);
        self.apm.update(bit);
        for (i, t) in self.tables.iter_mut().enumerate() {
            counter_update(
                &mut t[self.ctx[i] + node],
                bit,
                if i < HASHED_FROM { 1023 } else { 255 },
            );
        }
        for m in 0..2 {
            let (pred, len) = if m == 0 {
                (self.fwd_pred, &self.fwd)
            } else {
                (self.rc_pred, &self.rc)
            };
            if let Some(e) = expected(pred, hi) {
                let slot = self.match_slot(m, node, len);
                counter_update(&mut self.match_counters[slot], bit == e, 1023);
            }
        }
    }

    /// Codes one base through `io` and returns it (the decoded one when decoding).
    pub(crate) fn code(&mut self, io: &mut impl BitIo, base: u8) -> u8 {
        let p = self.predict(1, None);
        let hi = io.bit(p, base & 2 != 0);
        self.update(1, None, hi);
        let node = 2 + usize::from(hi);
        let p = self.predict(node, Some(hi));
        let lo = io.bit(p, base & 1 != 0);
        self.update(node, Some(hi), lo);
        let x = (u8::from(hi) << 1) | u8::from(lo);
        self.push(x);
        x
    }

    fn push(&mut self, x: u8) {
        let before = self.hist;
        self.hist = (self.hist << 2) | u64::from(x);
        self.rc_hist = (self.rc_hist >> 2) | (u64::from(3 - x) << 62);
        self.bases.push(x);
        let n = self.bases.len();
        self.learn_inverted_repeats(before, n);
        self.follow_matches(x);
        self.find_matches(n);
        self.set_contexts();
    }

    /// The reverse complement of the last k + 1 bases is a k-base context
    /// followed by the complement of the base k back.
    fn learn_inverted_repeats(&mut self, before: u64, n: usize) {
        for (i, &k) in ORDERS.iter().enumerate().skip(HASHED_FROM) {
            if n <= k as usize {
                continue;
            }
            let key = self.rc_hist >> (64 - 2 * k);
            let sym = 3 - ((before >> (2 * (k - 1))) & 3) as u8;
            let s = self.slot(i, key);
            let hi = sym & 2 != 0;
            let t = &mut self.tables[i];
            counter_update(&mut t[s + 1], hi, 255);
            counter_update(&mut t[s + 2 + usize::from(hi)], sym & 1 != 0, 255);
        }
    }

    fn follow_matches(&mut self, x: u8) {
        if self.fwd.len > 0 {
            if self.fwd_pred == Some(x) {
                self.fwd.len += 1;
                self.fwd.ptr += 1;
            } else {
                self.fwd.len = 0;
            }
        }
        if self.rc.len > 0 {
            if self.rc_pred == Some(x) && self.rc.ptr > 0 {
                self.rc.len += 1;
                self.rc.ptr -= 1;
            } else {
                self.rc.len = 0;
            }
        }
    }

    fn find_matches(&mut self, n: usize) {
        let min = MATCH_MIN as usize;
        if n < min {
            return;
        }
        let at = hash(self.hist & mask(MATCH_MIN), 0, self.hash_bits);
        if self.fwd.len == 0 {
            let cand = self.starts[at] as usize;
            if cand > 0 {
                let len = (1..=32.min(cand))
                    .take_while(|&i| self.bases[cand - i] == self.bases[n - i])
                    .count();
                if len >= min {
                    self.fwd = Match {
                        ptr: cand,
                        len: len as u32,
                    };
                }
            }
        }
        if self.rc.len == 0 {
            let cand =
                self.starts[hash(self.rc_hist >> (64 - 2 * MATCH_MIN), 0, self.hash_bits)] as usize;
            if cand > min {
                let start = cand - min;
                if (0..min).all(|i| self.bases[start + i] == 3 - self.bases[n - 1 - i]) {
                    self.rc = Match {
                        ptr: start - 1,
                        len: MATCH_MIN,
                    };
                }
            }
        }
        self.starts[at] = n as u32;
    }
}

/// The bit a match model expects at this node, if it still has a say.
fn expected(pred: Option<u8>, hi: Option<bool>) -> Option<bool> {
    let p = pred?;
    match hi {
        None => Some(p & 2 != 0),
        Some(h) if h == (p & 2 != 0) => Some(p & 1 != 0),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::coder::{Decoder, Encoder};
    use super::*;

    fn round_trip(bases: &[u8]) -> usize {
        let mut e = Encoder::new();
        let mut m = DnaModel::new(bases.len());
        for &b in bases {
            m.code(&mut e, b);
        }
        let data = e.finish();
        let mut d = Decoder::new(&data);
        let mut m = DnaModel::new(bases.len());
        let back: Vec<u8> = (0..bases.len()).map(|_| m.code(&mut d, 0)).collect();
        assert_eq!(back, bases);
        data.len()
    }

    fn random(n: usize, seed: u64) -> Vec<u8> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                (s >> 62) as u8
            })
            .collect()
    }

    #[test]
    fn random_bases_cost_about_two_bits() {
        let bases = random(20_000, 7);
        let bytes = round_trip(&bases);
        assert!(bytes < 20_000 * 2 / 8 * 103 / 100, "{bytes}");
    }

    #[test]
    fn repeats_and_reverse_complements_are_nearly_free() {
        let unit = random(5_000, 11);
        let rc: Vec<u8> = unit.iter().rev().map(|b| 3 - b).collect();
        let bases = [unit.clone(), unit.clone(), rc.clone(), unit, rc].concat();
        let bytes = round_trip(&bases);
        assert!(bytes < 5_000 * 2 / 8 * 125 / 100, "{bytes}");
    }

    #[test]
    fn short_and_empty_inputs_round_trip() {
        round_trip(&[]);
        round_trip(&[3]);
        round_trip(&random(25, 3));
    }
}
