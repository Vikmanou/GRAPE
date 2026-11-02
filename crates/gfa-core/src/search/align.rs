//! Local alignment with affine gaps inside a band of diagonals (Gotoh 1982).
//! Each cell carries where its alignment began and what it holds, so ranges and
//! identity come out without a traceback and memory stays one row wide.

/// blastn's scores for `-task blastn`: `BLAST_PENALTY`, `BLAST_GAP_OPEN_NUCL`
/// and `BLAST_GAP_EXTN_NUCL` in NCBI's algo/blast/core/blast_options.h, with
/// its +2 match. A gap of n bases costs 5 + 2n.
pub const MATCH: i32 = 2;
pub const MISMATCH: i32 = -3;
pub const GAP_OPEN: i32 = 5;
pub const GAP_EXTEND: i32 = 2;

const NEGATIVE: i32 = i32::MIN / 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Alignment {
    pub score: i32,
    pub q_start: u32,
    pub q_end: u32,
    pub t_start: u32,
    pub t_end: u32,
    pub matches: u32,
    /// Matches, mismatches and gap bases: BLAST's alignment length.
    pub columns: u32,
}

#[derive(Clone, Copy, Default)]
struct Cell {
    score: i32,
    q: u32,
    t: u32,
    matches: u32,
    columns: u32,
}

const CLOSED: Cell = Cell {
    score: NEGATIVE,
    q: 0,
    t: 0,
    matches: 0,
    columns: 0,
};

fn gap_from(open: Cell, extend: Cell) -> Cell {
    let opened = open.score - GAP_OPEN - GAP_EXTEND;
    let extended = extend.score - GAP_EXTEND;
    let (mut cell, score) = if opened >= extended {
        (open, opened)
    } else {
        (extend, extended)
    };
    cell.score = score;
    cell.columns += 1;
    cell
}

/// The best alignment of `query` to `target` whose diagonals (target position
/// less query position) stay in `lo..=hi`. `target` starts at `offset` of the
/// whole sequence, and returned target positions count from that sequence's start.
pub fn align(query: &[u8], target: &[u8], offset: u32, lo: i64, hi: i64) -> Option<Alignment> {
    let width = usize::try_from(hi - lo + 1).ok()?;
    let t0 = i64::from(offset);
    let t_end = t0 + target.len() as i64;
    let q_len = query.len() as i64;
    let first_row = (t0 + 1 - hi).max(1);
    let last_row = (t_end - lo).min(q_len);
    if first_row > last_row {
        return None;
    }
    // One extra slot on the right, as the row above is read one diagonal up.
    let mut h_up = vec![Cell::default(); width + 1];
    let mut h_row = vec![Cell::default(); width + 1];
    let mut f_up = vec![CLOSED; width + 1];
    let mut f_row = vec![CLOSED; width + 1];
    let mut best = Cell::default();
    let mut best_at = (0i64, 0i64);
    for i in first_row..=last_row {
        let q_byte = query[(i - 1) as usize];
        let mut e = CLOSED;
        let mut left = Cell::default();
        for k in 0..width {
            let j = i + lo + k as i64;
            if j <= t0 || j > t_end {
                h_row[k] = Cell {
                    score: 0,
                    ..Cell::default()
                };
                f_row[k] = CLOSED;
                left = h_row[k];
                e = CLOSED;
                continue;
            }
            let t_byte = target[(j - t0 - 1) as usize];
            let mut diagonal = h_up[k];
            if diagonal.score == 0 {
                diagonal = Cell {
                    score: 0,
                    q: (i - 1) as u32,
                    t: (j - 1) as u32,
                    matches: 0,
                    columns: 0,
                };
            }
            let same = q_byte == t_byte && matches!(q_byte, b'A' | b'C' | b'G' | b'T');
            diagonal.score += if same { MATCH } else { MISMATCH };
            diagonal.matches += u32::from(same);
            diagonal.columns += 1;
            e = gap_from(left, e);
            let f = gap_from(h_up[k + 1], f_up[k + 1]);
            let mut h = diagonal;
            if e.score > h.score {
                h = e;
            }
            if f.score > h.score {
                h = f;
            }
            if h.score <= 0 {
                h = Cell::default();
            }
            if h.score > best.score {
                best = h;
                best_at = (i, j);
            }
            h_row[k] = h;
            f_row[k] = f;
            left = h;
        }
        std::mem::swap(&mut h_up, &mut h_row);
        std::mem::swap(&mut f_up, &mut f_row);
    }
    (best.score > 0).then_some(Alignment {
        score: best.score,
        q_start: best.q,
        q_end: best_at.0 as u32,
        t_start: best.t,
        t_end: best_at.1 as u32,
        matches: best.matches,
        columns: best.columns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn whole(q: &[u8], t: &[u8]) -> Alignment {
        let hi = t.len() as i64;
        align(q, t, 0, -(q.len() as i64), hi).unwrap()
    }

    #[test]
    fn exact_substring() {
        let a = whole(b"GGGTTT", b"AAGGGTTTCC");
        assert_eq!((a.score, a.q_start, a.q_end), (12, 0, 6));
        assert_eq!((a.t_start, a.t_end, a.matches, a.columns), (2, 8, 6, 6));
    }

    #[test]
    fn a_mismatch_costs_three_and_keeps_the_columns() {
        let a = whole(b"AAAAAAAAGAAAAAAAA", b"AAAAAAAACAAAAAAAA");
        assert_eq!(a.score, 16 * 2 - 3);
        assert_eq!((a.matches, a.columns), (16, 17));
    }

    #[test]
    fn a_gap_costs_open_plus_extend_per_base() {
        let a = whole(
            b"ACGTACGTACGTACGTGGGGGGGGGGGG",
            b"ACGTACGTACGTACGTCCGGGGGGGGGGGG",
        );
        assert_eq!(a.score, 28 * 2 - 5 - 2 * 2);
        assert_eq!((a.matches, a.columns), (28, 30));
        let b = whole(
            b"ACGTACGTACGTACGTCCGGGGGGGGGGGG",
            b"ACGTACGTACGTACGTGGGGGGGGGGGG",
        );
        assert_eq!(b.score, a.score);
        assert_eq!((b.matches, b.columns), (28, 30));
    }

    #[test]
    fn n_never_matches() {
        assert!(align(b"NNNN", b"NNNN", 0, -4, 4).is_none());
    }

    #[test]
    fn a_band_limits_the_diagonals_and_an_offset_moves_positions() {
        assert!(align(b"GGGG", b"AAAAAAAAGGGG", 0, -1, 1).is_none());
        let a = align(b"GGGG", b"AAGGGG", 6, 6, 10).unwrap();
        assert_eq!((a.t_start, a.t_end), (8, 12));
    }
}
