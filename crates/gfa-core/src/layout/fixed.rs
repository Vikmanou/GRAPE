//! The drawing geometry around positions saved earlier, such as a session
//! file's, with no layout run: the chains and links a layout of the same
//! topology draws, so the positions line up point for point.

use super::{Chains, LayoutOptions, Topology, TopologyError, link_geometry};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedError {
    Topology(TopologyError),
    /// The positions hold another number of points than the graph's chains.
    Points {
        expected: usize,
        found: usize,
    },
}

impl std::fmt::Display for FixedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FixedError::Topology(e) => e.fmt(f),
            FixedError::Points { expected, found } => write!(
                f,
                "the saved positions are for {found} points, but this graph draws {expected}"
            ),
        }
    }
}

impl std::error::Error for FixedError {}

pub struct Fixed {
    pub chains: Chains,
    /// `(first point, segment)` per ribbon piece.
    pub pieces: Vec<u32>,
    /// `[end a, inner a, end b, inner b]` per link.
    pub links: Vec<u32>,
}

impl Fixed {
    pub fn new(t: &Topology, points: usize) -> Result<Fixed, FixedError> {
        t.validate().map_err(FixedError::Topology)?;
        let chains = Chains::build(t, LayoutOptions::default().max_pieces);
        let expected = chains.points();
        if points != expected {
            return Err(FixedError::Points {
                expected,
                found: points,
            });
        }
        let links = link_geometry(t, &chains);
        let pieces = chains.pieces();
        Ok(Fixed {
            chains,
            pieces,
            links,
        })
    }
}
