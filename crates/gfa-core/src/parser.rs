//! Push-based streaming parser. Lines split across chunks are carried over,
//! so the result never depends on where chunks break.

use crate::builder::Builder;
use crate::fastg::Fastg;
use crate::gfa;
use crate::graph::{Format, Graph};
use crate::seq::SeqMode;
use crate::warnings::FatalError;

/// A NUL byte this far into the file means binary input.
const SNIFF_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseOptions {
    pub seq_mode: SeqMode,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            seq_mode: SeqMode::FileOffsets,
        }
    }
}

enum Reader {
    /// Only blank lines so far.
    Undecided,
    Gfa,
    Fastg(Fastg),
}

pub struct Parser {
    carry: Vec<u8>,
    carry_offset: u64,
    offset: u64,
    line_no: u64,
    reader: Reader,
    builder: Builder,
    seq_mode: SeqMode,
}

impl Parser {
    pub fn new(options: ParseOptions) -> Self {
        Self {
            carry: Vec::new(),
            carry_offset: 0,
            offset: 0,
            line_no: 0,
            reader: Reader::Undecided,
            builder: Builder::new(options.seq_mode),
            seq_mode: options.seq_mode,
        }
    }

    pub fn bytes_read(&self) -> u64 {
        self.offset
    }

    pub fn push(&mut self, chunk: &[u8]) {
        if self.builder.fatal.is_some() {
            return;
        }
        if self.offset < SNIFF_BYTES {
            let n = chunk.len().min((SNIFF_BYTES - self.offset) as usize);
            if chunk[..n].contains(&0) {
                self.builder.fatal = Some(FatalError::NotText);
                return;
            }
        }
        let mut start = 0;
        while let Some(nl) = memchr::memchr(b'\n', &chunk[start..]) {
            let end = start + nl;
            if self.carry.is_empty() {
                self.line(&chunk[start..end], self.offset + start as u64);
            } else {
                let mut line = std::mem::take(&mut self.carry);
                line.extend_from_slice(&chunk[start..end]);
                self.line(&line, self.carry_offset);
                line.clear();
                self.carry = line;
            }
            if self.builder.fatal.is_some() {
                return;
            }
            start = end + 1;
        }
        if start < chunk.len() {
            if self.carry.is_empty() {
                self.carry_offset = self.offset + start as u64;
            }
            self.carry.extend_from_slice(&chunk[start..]);
        }
        self.offset += chunk.len() as u64;
    }

    fn line(&mut self, line: &[u8], offset: u64) {
        self.line_no += 1;
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if let Reader::Undecided = self.reader {
            self.reader = match line.trim_ascii_start().first() {
                None => return,
                Some(b'>') => Reader::Fastg(Fastg::default()),
                Some(_) => Reader::Gfa,
            };
        }
        let b = &mut self.builder;
        match &mut self.reader {
            Reader::Undecided => {}
            Reader::Gfa => gfa::line(b, line, offset, self.line_no),
            Reader::Fastg(f) => f.line(b, line, offset, self.line_no),
        }
    }

    pub fn finish(mut self) -> Result<Graph, FatalError> {
        if !self.carry.is_empty() && self.builder.fatal.is_none() {
            let line = std::mem::take(&mut self.carry);
            self.line(&line, self.carry_offset);
        }
        let format = match &mut self.reader {
            Reader::Fastg(f) => {
                f.close(&mut self.builder);
                Format::Fastg
            }
            _ => Format::Gfa,
        };
        if let Some(fatal) = self.builder.fatal.take() {
            return Err(fatal);
        }
        Graph::build(self.builder, format, self.seq_mode)
    }
}

pub fn parse(bytes: &[u8], options: ParseOptions) -> Result<Graph, FatalError> {
    let mut parser = Parser::new(options);
    parser.push(bytes);
    parser.finish()
}
