//! Skyline bottom-left packing (Jylänki, "A Thousand Ways to Pack the Bin",
//! 2010): each rectangle goes where its top is lowest, then leftmost. The
//! layout grows downward, as screens read.

/// Bandage's `componentSeparation` default.
const COMPONENT_GAP: f32 = 50.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy)]
struct Span {
    x: f32,
    y: f32,
    w: f32,
}

/// Top-left corners for `rects`, already sorted largest first, packed into
/// a strip `width` wide (widened to the widest rectangle).
pub fn skyline(rects: &[Rect], width: f32) -> Vec<(f32, f32)> {
    let width = rects.iter().map(|r| r.w).fold(width, f32::max);
    let mut sky = vec![Span {
        x: 0.0,
        y: 0.0,
        w: width,
    }];
    rects
        .iter()
        .map(|r| {
            let (i, y) = lowest(&sky, r.w, width);
            let x = sky[i].x;
            place(&mut sky, i, x, y + r.h, r.w);
            (x, y)
        })
        .collect()
}

/// The span to start at and the height there, scanning every start with a
/// sliding window whose maximum is kept in a monotonic deque.
fn lowest(sky: &[Span], w: f32, width: f32) -> (usize, f32) {
    let mut best = (0, f32::INFINITY);
    let mut window = std::collections::VecDeque::new();
    let mut end = 0;
    for i in 0..sky.len() {
        let x = sky[i].x;
        if x + w > width * 1.000_01 {
            break;
        }
        while end < sky.len() && sky[end].x < x + w {
            while window
                .back()
                .is_some_and(|&j: &usize| sky[j].y <= sky[end].y)
            {
                window.pop_back();
            }
            window.push_back(end);
            end += 1;
        }
        while window.front().is_some_and(|&j| j < i) {
            window.pop_front();
        }
        let y = window.front().map_or(0.0, |&j| sky[j].y);
        if y < best.1 {
            best = (i, y);
        }
    }
    best
}

fn place(sky: &mut Vec<Span>, i: usize, x: f32, top: f32, w: f32) {
    let right = x + w;
    let mut j = i;
    while j < sky.len() && sky[j].x + sky[j].w <= right {
        j += 1;
    }
    if j < sky.len() && sky[j].x < right {
        let cut = right - sky[j].x;
        sky[j].x = right;
        sky[j].w -= cut;
    }
    sky.splice(i..j, [Span { x, y: top, w }]);
    // Neighbours at the same height become one span.
    let mut k = i.saturating_sub(1);
    while k + 1 < sky.len() && k <= i + 1 {
        if sky[k].y == sky[k + 1].y {
            sky[k].w += sky[k + 1].w;
            sky.remove(k + 1);
        } else {
            k += 1;
        }
    }
}

/// Left to right in rows of `width`, each row as tall as its tallest item.
pub fn rows(rects: &[Rect], width: f32, gap: f32, top: f32) -> Vec<(f32, f32)> {
    let (mut x, mut y, mut row) = (0.0f32, top, 0.0f32);
    rects
        .iter()
        .map(|r| {
            if x > 0.0 && x + r.w > width {
                x = 0.0;
                y += row + gap;
                row = 0.0;
            }
            let at = (x, y);
            x += r.w + gap;
            row = row.max(r.h);
            at
        })
        .collect()
}

/// Multi-segment components are skyline-packed largest box first; single
/// segments follow in rows underneath, in rank order.
pub(crate) fn pack_components(boxes: &[(f32, f32, f32, f32)], frozen: &[bool]) -> Vec<(f32, f32)> {
    let size = |c: usize| {
        let (x0, y0, x1, y1) = boxes[c];
        Rect {
            w: x1 - x0 + COMPONENT_GAP,
            h: y1 - y0 + COMPONENT_GAP,
        }
    };
    let (mut big, small): (Vec<usize>, Vec<usize>) = (0..boxes.len()).partition(|&c| !frozen[c]);
    big.sort_by(|&a, &b| {
        let (ra, rb) = (size(a), size(b));
        (rb.w * rb.h).total_cmp(&(ra.w * ra.h)).then(a.cmp(&b))
    });
    let rects: Vec<Rect> = big.iter().map(|&c| size(c)).collect();
    let small_rects: Vec<Rect> = small.iter().map(|&c| size(c)).collect();
    let area: f32 = rects.iter().chain(&small_rects).map(|r| r.w * r.h).sum();
    // A strip a little wider than tall suits a landscape screen.
    let width = rects
        .iter()
        .map(|r| r.w)
        .fold((area * 1.6).sqrt(), f32::max);
    let placed = skyline(&rects, width);
    let floor = placed
        .iter()
        .zip(&rects)
        .map(|(&(_, y), r)| y + r.h)
        .fold(0.0, f32::max);
    let lined = rows(&small_rects, width, 0.0, floor);
    let mut offsets = vec![(0.0, 0.0); boxes.len()];
    for (&c, &at) in big.iter().zip(&placed).chain(small.iter().zip(&lined)) {
        offsets[c] = at;
    }
    offsets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::rng::Rng;
    use proptest::prelude::*;

    fn overlaps(a: (f32, f32), ra: Rect, b: (f32, f32), rb: Rect) -> bool {
        const E: f32 = 1e-3;
        a.0 + ra.w > b.0 + E && b.0 + rb.w > a.0 + E && a.1 + ra.h > b.1 + E && b.1 + rb.h > a.1 + E
    }

    #[test]
    fn fills_the_floor_first() {
        let r = Rect { w: 1.0, h: 1.0 };
        let at = skyline(&[r, r, r], 2.0);
        assert_eq!(at, vec![(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)]);
    }

    proptest! {
        #[test]
        fn packed_rects_never_overlap(seed: u64, n in 1usize..120) {
            let mut rng = Rng::new(seed);
            let mut rects: Vec<Rect> = (0..n)
                .map(|_| Rect { w: 1.0 + rng.next_f32() * 50.0, h: 1.0 + rng.next_f32() * 50.0 })
                .collect();
            rects.sort_by(|a, b| (b.w * b.h).total_cmp(&(a.w * a.h)));
            let width = 120.0;
            let at = skyline(&rects, width);
            for i in 0..n {
                prop_assert!(at[i].0 >= 0.0 && at[i].1 >= 0.0);
                prop_assert!(at[i].0 + rects[i].w <= width.max(rects[i].w) * 1.0001);
                for j in 0..i {
                    prop_assert!(!overlaps(at[i], rects[i], at[j], rects[j]), "{i} and {j}");
                }
            }
            let row = rows(&rects, width, 2.0, 0.0);
            for i in 0..n {
                for j in 0..i {
                    prop_assert!(!overlaps(row[i], rects[i], row[j], rects[j]));
                }
            }
        }
    }
}
