//! Binary arithmetic coding with logistic mixing, after Matt Mahoney's lpaq1
//! (public domain, mattmahoney.net/dc): 12-bit probabilities, a carryless
//! 32-bit coder, and integer-only squash and stretch, so a link packed in one
//! browser unpacks bit for bit in any other.

/// Where a model's bits go: the encoder writes the given bit, the decoder
/// ignores it and returns the bit it reads. One model loop serves both.
pub(crate) trait BitIo {
    /// `p` is the probability that the bit is 1, out of 4096.
    fn bit(&mut self, p: u32, bit: bool) -> bool;
}

pub(crate) struct Encoder {
    low: u32,
    high: u32,
    out: Vec<u8>,
}

impl Encoder {
    pub(crate) fn new() -> Self {
        Self {
            low: 0,
            high: u32::MAX,
            out: Vec::new(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.out.len()
    }

    pub(crate) fn finish(mut self) -> Vec<u8> {
        for _ in 0..4 {
            self.out.push((self.low >> 24) as u8);
            self.low <<= 8;
        }
        self.out
    }
}

fn split(low: u32, high: u32, p: u32) -> u32 {
    let p = u64::from(p.clamp(1, 4095));
    low + ((u64::from(high - low) * p) >> 12) as u32
}

impl BitIo for Encoder {
    fn bit(&mut self, p: u32, bit: bool) -> bool {
        let mid = split(self.low, self.high, p);
        if bit {
            self.high = mid;
        } else {
            self.low = mid + 1;
        }
        while (self.low ^ self.high) & 0xff00_0000 == 0 {
            self.out.push((self.high >> 24) as u8);
            self.low <<= 8;
            self.high = (self.high << 8) | 0xff;
        }
        bit
    }
}

pub(crate) struct Decoder<'a> {
    low: u32,
    high: u32,
    x: u32,
    input: &'a [u8],
    pos: usize,
}

impl<'a> Decoder<'a> {
    pub(crate) fn new(input: &'a [u8]) -> Self {
        let mut d = Self {
            low: 0,
            high: u32::MAX,
            x: 0,
            input,
            pos: 0,
        };
        for _ in 0..4 {
            d.x = (d.x << 8) | u32::from(d.next());
        }
        d
    }

    /// Past the end reads zeros, so a cut link decodes to garbage the
    /// checksum rejects instead of panicking.
    fn next(&mut self) -> u8 {
        let b = self.input.get(self.pos).copied().unwrap_or(0);
        self.pos += 1;
        b
    }
}

impl BitIo for Decoder<'_> {
    fn bit(&mut self, p: u32, _bit: bool) -> bool {
        let mid = split(self.low, self.high, p);
        let bit = self.x <= mid;
        if bit {
            self.high = mid;
        } else {
            self.low = mid + 1;
        }
        while (self.low ^ self.high) & 0xff00_0000 == 0 {
            self.low <<= 8;
            self.high = (self.high << 8) | 0xff;
            self.x = (self.x << 8) | u32::from(self.next());
        }
        bit
    }
}

const SQUASH_KNOTS: [i32; 33] = [
    1, 2, 3, 6, 10, 16, 27, 45, 73, 120, 194, 310, 488, 747, 1101, 1546, 2047, 2549, 2994, 3348,
    3607, 3785, 3901, 3975, 4022, 4050, 4068, 4079, 4085, 4089, 4092, 4093, 4094,
];

/// 4096 / (1 + e^(-d/256)), interpolated between knots as lpaq1 does.
pub(crate) const fn squash(d: i32) -> i32 {
    if d > 2047 {
        return 4095;
    }
    if d < -2047 {
        return 1;
    }
    let w = d & 127;
    let i = ((d >> 7) + 16) as usize;
    (SQUASH_KNOTS[i] * (128 - w) + SQUASH_KNOTS[i + 1] * w + 64) >> 7
}

const fn stretch_table() -> [i16; 4096] {
    let mut t = [0i16; 4096];
    let mut next = 0usize;
    let mut x = -2047;
    while x <= 2047 {
        let v = squash(x) as usize;
        while next <= v {
            t[next] = x as i16;
            next += 1;
        }
        x += 1;
    }
    while next < 4096 {
        t[next] = 2047;
        next += 1;
    }
    t
}

static STRETCH: [i16; 4096] = stretch_table();

/// The inverse of `squash`: ln(p / (1 - p)) scaled by 256.
pub(crate) fn stretch(p: u32) -> i32 {
    i32::from(STRETCH[p.min(4095) as usize])
}

/// A counter is a `u32`: P(1) in the high 22 bits, times seen in the low 10.
/// It learns fast at first (rate 1/(n + 1.5)) and settles to 1/(limit + 1.5).
pub(crate) const COUNTER_START: u32 = 1 << 31;

const fn recip_table() -> [u32; 1024] {
    let mut t = [0u32; 1024];
    let mut n = 0;
    while n < 1024 {
        t[n] = 131_072 / (2 * n as u32 + 3);
        n += 1;
    }
    t
}

static RECIP: [u32; 1024] = recip_table();

pub(crate) fn counter_p(v: u32) -> u32 {
    v >> 20
}

pub(crate) fn counter_update(slot: &mut u32, bit: bool, limit: u32) {
    let v = *slot;
    let n = v & 1023;
    let p = i64::from(v >> 10);
    let target = if bit { (1 << 22) - 1 } else { 0 };
    let p = p + (((target - p) * i64::from(RECIP[n as usize])) >> 16);
    *slot = ((p as u32) << 10) | if n < limit { n + 1 } else { n };
}

/// Weighted sum of stretched predictions, trained online toward the coded bit.
pub(crate) struct Mixer {
    n: usize,
    weights: Vec<i32>,
    inputs: Vec<i32>,
    set: usize,
    pr: i32,
    rate: i32,
}

impl Mixer {
    pub(crate) fn new(n: usize, sets: usize, rate: i32) -> Self {
        Self {
            n,
            weights: vec![1 << 14; n * sets],
            inputs: Vec::with_capacity(n),
            set: 0,
            pr: 2048,
            rate,
        }
    }

    pub(crate) fn add(&mut self, x: i32) {
        self.inputs.push(x);
    }

    pub(crate) fn mix(&mut self, set: usize) -> u32 {
        debug_assert_eq!(self.inputs.len(), self.n);
        self.set = set * self.n;
        let w = &self.weights[self.set..self.set + self.n];
        let dot: i64 = self
            .inputs
            .iter()
            .zip(w)
            .map(|(&x, &w)| i64::from(x) * i64::from(w))
            .sum();
        self.pr = squash((dot >> 16).clamp(-2047, 2047) as i32);
        self.pr as u32
    }

    pub(crate) fn update(&mut self, bit: bool) {
        let err = ((i32::from(bit) << 12) - self.pr) * self.rate;
        let w = &mut self.weights[self.set..self.set + self.n];
        for (w, &x) in w.iter_mut().zip(&self.inputs) {
            *w += (x * err) >> 13;
        }
        self.inputs.clear();
    }
}

/// Secondary estimation (lpaq1's APM): refines a probability within a small
/// context by interpolating between 33 learned points on the stretch axis.
pub(crate) struct Apm {
    t: Vec<u16>,
    index: usize,
}

impl Apm {
    pub(crate) fn new(contexts: usize) -> Self {
        let row: Vec<u16> = (0..33)
            .map(|j| (squash((j - 16) * 128) * 16) as u16)
            .collect();
        let t = row.repeat(contexts);
        Self { t, index: 0 }
    }

    pub(crate) fn refine(&mut self, pr: u32, cx: usize) -> u32 {
        let s = stretch(pr) + 2048;
        let lo = (s >> 7) as usize;
        let w = (s & 127) as u32;
        let i = cx * 33 + lo;
        self.index = i + (w >> 6) as usize;
        (u32::from(self.t[i]) * (128 - w) + u32::from(self.t[i + 1]) * w) >> 11
    }

    pub(crate) fn update(&mut self, bit: bool) {
        let g = if bit { 65535 } else { 0 };
        let t = &mut self.t[self.index];
        *t = (i32::from(*t) + ((g - i32::from(*t)) >> 6)) as u16;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stretch_inverts_squash() {
        // Past ±1500 squash rounds many inputs to the same probability.
        for d in (-1500..1500).step_by(37) {
            assert!((stretch(squash(d) as u32) - d).abs() < 40, "{d}");
        }
    }

    #[test]
    fn coder_round_trips_skewed_bits() {
        let bits: Vec<bool> = (0..5000u32)
            .map(|i| i.wrapping_mul(2_654_435_761) % 7 == 0)
            .collect();
        let probs: Vec<u32> = (0..5000u32).map(|i| 1 + (i * 37) % 4094).collect();
        let mut e = Encoder::new();
        for (&b, &p) in bits.iter().zip(&probs) {
            e.bit(p, b);
        }
        let data = e.finish();
        let mut d = Decoder::new(&data);
        for (&b, &p) in bits.iter().zip(&probs) {
            assert_eq!(d.bit(p, false), b);
        }
    }
}
