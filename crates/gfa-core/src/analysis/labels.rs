//! Segment labels as Bandage writes them: `getNodeText` and
//! `getCustomLabelForDisplay` (graph/graphicsitemnode.cpp,
//! graph/debruijnnode.cpp), with numbers formatted by `formatIntForDisplay`
//! and `formatDepthForDisplay` (program/globals.cpp) in an English locale.

use crate::store::graph::Graph;
use crate::store::seg_flags;

/// Which lines a label shows, in Bandage's order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LabelContent {
    /// The LB tag, then the L2 tag.
    pub custom: bool,
    pub name: bool,
    pub length: bool,
    pub depth: bool,
}

/// The lines of one segment's label; a depth that is unknown shows no line.
pub fn label_lines(g: &Graph, segment: u32, content: LabelContent) -> Vec<String> {
    let i = segment as usize;
    let mut lines = Vec::new();
    if content.custom {
        let custom = &g.custom;
        // LB holds lines split by a literal backslash and n; Bandage splits
        // L2 on real newlines, which a GFA field cannot hold.
        if let Some(lb) = find(&custom.label, segment) {
            lines.extend(lb.split("\\n").map(str::to_owned));
        }
        if let Some(l2) = find(&custom.label2, segment) {
            lines.push(l2.to_owned());
        }
    }
    if content.name {
        lines.push(String::from_utf8_lossy(g.names.get(segment)).into_owned());
    }
    if content.length {
        lines.push(format!(
            "{} bp",
            format_count(u64::from(g.segments.length[i]))
        ));
    }
    let depth = f64::from(g.segments.depth[i]);
    if content.depth && !depth.is_nan() {
        lines.push(format_depth(depth));
    }
    lines
}

fn find(list: &[(u32, String)], segment: u32) -> Option<&str> {
    list.binary_search_by_key(&segment, |e| e.0)
        .ok()
        .map(|k| list[k].1.as_str())
}

/// Per segment, the order labels are placed in (longest segment first, then
/// by id), then `longest line in characters | lines << 16`, 0 for no label;
/// the layout labels.wgsl reads.
pub fn label_sizes(g: &Graph, content: LabelContent) -> Vec<u32> {
    let n = g.segments.len();
    let mut order: Vec<u32> = (0..n as u32).collect();
    order.sort_by_key(|&s| (std::cmp::Reverse(g.segments.length[s as usize]), s));
    let mut out = vec![0u32; n * 2];
    for (rank, &s) in order.iter().enumerate() {
        out[s as usize] = rank as u32;
    }
    for s in 0..n {
        if g.segments.flags[s] & seg_flags::DEFINED == 0 {
            continue;
        }
        let lines = label_lines(g, s as u32, content);
        let widest = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0);
        if widest > 0 {
            out[n + s] = widest.min(0xffff) as u32 | (lines.len().min(0xffff) as u32) << 16;
        }
    }
    out
}

/// `QLocale::toString` of an integer: thousands separated by commas.
pub fn format_count(n: u64) -> String {
    group_thousands(&n.to_string())
}

fn group_thousands(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Bandage's `formatDepthForDisplay`: one decimal at 10 and above, one more
/// for each power of ten below, rounded half up by adding half the last
/// place, then cut from `QLocale::toString(num, 'f')`'s six decimals.
pub fn format_depth(depth: f64) -> String {
    if depth == 0.0 {
        return "0.0x".to_owned();
    }
    let mut decimals = 1;
    let mut scaled = depth.abs();
    while scaled < 10.0 {
        scaled *= 10.0;
        decimals += 1;
    }
    let num = depth + 0.5 / 10f64.powi(decimals);
    let fixed = format!("{:.6}", num.abs());
    let (whole, fraction) = fixed.split_once('.').unwrap_or((&fixed, ""));
    let kept = &fraction[..fraction.len().min(decimals as usize)];
    let sign = if num < 0.0 { "-" } else { "" };
    format!("{sign}{}.{kept}x", group_thousands(whole))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_group_thousands() {
        assert_eq!(format_count(0), "0");
        assert_eq!(format_count(999), "999");
        assert_eq!(format_count(1234), "1,234");
        assert_eq!(format_count(1_234_567), "1,234,567");
    }

    #[test]
    fn depths_follow_bandage() {
        assert_eq!(format_depth(0.0), "0.0x");
        assert_eq!(format_depth(12.34), "12.3x");
        assert_eq!(format_depth(12.36), "12.4x");
        assert_eq!(format_depth(5.0), "5.00x");
        assert_eq!(format_depth(0.05), "0.0500x");
        assert_eq!(format_depth(1234.5), "1,234.5x");
    }
}
