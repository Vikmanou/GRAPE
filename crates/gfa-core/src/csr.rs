//! Adjacency in CSR form over segment ends, so traversals respect
//! orientation. End `2s` is segment `s`'s start (left) and `2s + 1` its end
//! (right). A link `a+ b+` leaves `a` at its right end and enters `b` at its
//! left end; `-` swaps the end on that side.

use crate::store::Links;

pub fn end(segment: u32, right: bool) -> u32 {
    segment * 2 + u32::from(right)
}

pub fn link_ends(links: &Links, i: usize) -> (u32, u32) {
    (
        end(links.from[i], !links.from_reverse(i)),
        end(links.to[i], links.to_reverse(i)),
    )
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Adjacency {
    pub offsets: Vec<u32>,
    /// The end at the other side.
    pub targets: Vec<u32>,
    pub links: Vec<u32>,
}

impl Adjacency {
    /// A link joining an end to itself (`a+ a-`) is listed once for that end.
    pub fn build(segments: usize, links: &Links) -> Self {
        let ends = segments * 2;
        let mut offsets = vec![0u32; ends + 1];
        for i in 0..links.len() {
            let (a, b) = link_ends(links, i);
            offsets[a as usize + 1] += 1;
            if a != b {
                offsets[b as usize + 1] += 1;
            }
        }
        for e in 0..ends {
            offsets[e + 1] += offsets[e];
        }
        let total = offsets[ends] as usize;
        let mut fill: Vec<u32> = offsets[..ends].to_vec();
        let mut targets = vec![0u32; total];
        let mut link_ids = vec![0u32; total];
        let mut put = |at: u32, other: u32, link: u32| {
            let slot = &mut fill[at as usize];
            targets[*slot as usize] = other;
            link_ids[*slot as usize] = link;
            *slot += 1;
        };
        for i in 0..links.len() {
            let (a, b) = link_ends(links, i);
            put(a, b, i as u32);
            if a != b {
                put(b, a, i as u32);
            }
        }
        Self {
            offsets,
            targets,
            links: link_ids,
        }
    }

    pub fn degree(&self, end: u32) -> u32 {
        let e = end as usize;
        self.offsets[e + 1] - self.offsets[e]
    }

    pub fn neighbours(&self, end: u32) -> &[u32] {
        let e = end as usize;
        &self.targets[self.offsets[e] as usize..self.offsets[e + 1] as usize]
    }

    pub fn heap_bytes(&self) -> usize {
        (self.offsets.capacity() + self.targets.capacity() + self.links.capacity()) * 4
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fields::Overlap;

    #[test]
    fn ends_follow_orientation() {
        let mut links = Links::default();
        links.insert((0, false), (1, false), Overlap::Unknown); // 0 right - 1 left
        links.insert((1, false), (2, true), Overlap::Unknown); // 1 right - 2 right
        links.insert((2, false), (2, true), Overlap::Unknown); // 2 right - 2 right
        let adj = Adjacency::build(3, &links);
        assert_eq!(adj.neighbours(end(0, true)), &[end(1, false)]);
        assert_eq!(adj.neighbours(end(1, true)), &[end(2, true)]);
        assert_eq!(adj.degree(end(2, true)), 2);
        assert_eq!(adj.degree(end(0, false)), 0);
        assert_eq!(adj.degree(end(2, false)), 0);
    }
}
