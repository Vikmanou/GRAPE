//! Lossless packing of a graph file small enough to travel inside a share
//! link. The file is split into streams (see `split`) and each is coded with
//! its own context-mixing model: `dna` for bases, `text` for the rest.
//!
//! Layout: `G`, version 1, mode (0 GFA, 1 FASTA), varint file length, CRC-32
//! of the file (little endian), then for the text, lengths, side and base
//! streams in turn: varint raw length, varint coded length, coded bytes.

mod coder;
mod dna;
mod split;
mod text;

use coder::{Decoder, Encoder};
use dna::DnaModel;
use split::{Mode, Streams, put, take};
use text::TextModel;

/// What `unpack` agrees to rebuild, so a crafted link cannot exhaust memory.
pub const MAX_UNPACKED: usize = 512 << 20;

const MAGIC: u8 = b'G';
const VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackError {
    /// Not a packed graph, cut short, or altered.
    Corrupt,
    /// Packed by a newer GRAPE.
    Version,
    /// Would unpack to more than `MAX_UNPACKED` bytes.
    TooLarge,
}

impl std::fmt::Display for PackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Corrupt => "the packed graph is damaged or incomplete",
            Self::Version => "the packed graph needs a newer GRAPE",
            Self::TooLarge => "the packed graph is too large to open",
        })
    }
}

impl std::error::Error for PackError {}

pub fn pack(file: &[u8]) -> Vec<u8> {
    pack_within(file, usize::MAX).unwrap_or_default()
}

/// Like `pack`, but gives up as soon as the result would pass `limit` bytes,
/// so a graph too big for a link costs seconds rather than minutes.
pub fn pack_within(file: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mode = split::mode_of(file);
    let s = split::split(file, mode);
    let mut out = vec![MAGIC, VERSION, u8::from(mode == Mode::Fasta)];
    put(&mut out, file.len() as u64);
    out.extend_from_slice(&crc32(file).to_le_bytes());
    for raw in [&s.text, &s.lengths, &s.side] {
        let mut e = Encoder::new();
        let mut m = TextModel::new(raw.len());
        for chunk in raw.chunks(CHECK_EVERY) {
            for &b in chunk {
                m.code(&mut e, b);
            }
            (out.len() + e.len() <= limit).then_some(())?;
        }
        section(&mut out, raw.len(), &e.finish());
    }
    let mut e = Encoder::new();
    let mut m = DnaModel::new(s.bases.len());
    for chunk in s.bases.chunks(CHECK_EVERY) {
        for &b in chunk {
            m.code(&mut e, b);
        }
        (out.len() + e.len() <= limit).then_some(())?;
    }
    section(&mut out, s.bases.len(), &e.finish());
    (out.len() <= limit).then_some(out)
}

const CHECK_EVERY: usize = 1 << 16;

fn section(out: &mut Vec<u8>, raw: usize, coded: &[u8]) {
    put(out, raw as u64);
    put(out, coded.len() as u64);
    out.extend_from_slice(coded);
}

pub fn unpack(packed: &[u8]) -> Result<Vec<u8>, PackError> {
    let [magic, version, mode, ..] = *packed else {
        return Err(PackError::Corrupt);
    };
    if magic != MAGIC {
        return Err(PackError::Corrupt);
    }
    if version != VERSION {
        return Err(PackError::Version);
    }
    let mode = match mode {
        0 => Mode::Gfa,
        1 => Mode::Fasta,
        _ => return Err(PackError::Corrupt),
    };
    let mut pos = 3;
    let len = usize::try_from(take(packed, &mut pos)?).map_err(|_| PackError::TooLarge)?;
    if len > MAX_UNPACKED {
        return Err(PackError::TooLarge);
    }
    let crc = packed.get(pos..pos + 4).ok_or(PackError::Corrupt)?;
    let crc = u32::from_le_bytes([crc[0], crc[1], crc[2], crc[3]]);
    pos += 4;
    let next = |pos: &mut usize, most: usize| -> Result<(usize, &[u8]), PackError> {
        let raw = take(packed, pos)?;
        let coded = take(packed, pos)?;
        let raw = usize::try_from(raw)
            .ok()
            .filter(|&r| r <= most)
            .ok_or(PackError::Corrupt)?;
        let end = usize::try_from(coded)
            .ok()
            .and_then(|c| pos.checked_add(c))
            .ok_or(PackError::Corrupt)?;
        let data = packed.get(*pos..end).ok_or(PackError::Corrupt)?;
        *pos = end;
        Ok((raw, data))
    };
    let mut texts = Vec::with_capacity(3);
    // Bounds on each stream for a file of `len` bytes: a FASTA line of one
    // byte gives a two-byte length, and a lone odd base costs three side bytes.
    for most in [len, 2 * len + 2, 4 * len + 16] {
        let (raw, data) = next(&mut pos, most)?;
        let mut d = Decoder::new(data);
        let mut m = TextModel::new(raw);
        texts.push((0..raw).map(|_| m.code(&mut d, 0)).collect::<Vec<u8>>());
    }
    let (raw, data) = next(&mut pos, len)?;
    let mut d = Decoder::new(data);
    let mut m = DnaModel::new(raw);
    let bases = (0..raw).map(|_| m.code(&mut d, 0)).collect();
    let [text, lengths, side] = <[Vec<u8>; 3]>::try_from(texts).map_err(|_| PackError::Corrupt)?;
    let file = split::join(
        &Streams {
            text,
            lengths,
            bases,
            side,
        },
        mode,
        len,
    )?;
    if file.len() != len || crc32(&file) != crc {
        return Err(PackError::Corrupt);
    }
    Ok(file)
}

const fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        t[i] = c;
        i += 1;
    }
    t
}

static CRC: [u32; 256] = crc_table();

/// CRC-32 as in gzip (ISO 3309).
fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(!0u32, |c, &b| {
        CRC[((c ^ u32::from(b)) & 0xff) as usize] ^ (c >> 8)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_the_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
