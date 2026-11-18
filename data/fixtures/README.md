# Test fixtures

Small graph files for GRAPE's own tests: Rust (`crates/gfa-core/tests`), Vitest (`web/tests/unit`) and Playwright (`web/tests/e2e`). Each one is a few hundred bytes and exists to pin one behaviour of the parser, the layout, the search or the exports. They are committed, and they are not meant for trying the app on real data: that is `../samples/`.

`manifest.json` lists every file here with what it is for and where it came from. A test that needs a new case adds a file and a manifest entry. Tests that read the whole folder (`pack.rs`, `search.rs`, `scripts/fuzz.mjs`) also see this README and the manifest, and must tolerate them.

Read them in tests through `common::testdata(name)` in Rust, `repo('data/fixtures/<name>')` in Playwright and `testdata(name)` in Vitest.

## Credits

Everything here was written for GRAPE, and is covered by the repository's licence, except:

- `csgA.fasta`: the _csgA_ gene of _Myxococcus xanthus_ DK 1622, NCBI nucleotide record [NC_008095.1](https://www.ncbi.nlm.nih.gov/nuccore/NC_008095.1), bases 1520199 to 1520888. Sequence records in the International Nucleotide Sequence Database Collaboration are in the public domain.
- `search.gfa` holds random bases, not a real genome.

The real graphs GRAPE is tried on, with their sources and licences, are in [../samples/README.md](../samples/README.md); the four example graphs the app ships are credited in [web/public/examples/CREDITS.md](../../web/public/examples/CREDITS.md).
