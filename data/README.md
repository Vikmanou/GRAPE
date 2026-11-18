# Data

Graph files used by GRAPE's tests, benchmarks and manual checks. Two folders, for two purposes.

| Folder                                | What                                                | In git                              | Used for                                                                                                                      |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`fixtures/`](fixtures/manifest.json) | Tiny handcrafted files, 33 to 1,164 bytes           | Yes                                 | Automated tests: Rust (`crates/gfa-core/tests`), Vitest (`web/tests/unit`), Playwright (`web/tests/e2e`), and the fuzz corpus |
| [`samples/`](samples/README.md)       | Real assembly and pangenome graphs, 18 KB to 3.6 GB | No, downloaded by `npm run samples` | Trying GRAPE on real data, benchmarks, and a few specs that skip when the files are missing                                   |

## fixtures

Each file pins one behaviour of the parser, the layout, the search or the exports. `fixtures/manifest.json` lists every file with what it is for and where it came from. A test that needs a new case adds a file and a manifest entry. Tests that read the whole folder (`pack.rs`, `search.rs`, `scripts/fuzz.mjs`) also see the manifest and must tolerate it.

Read them in tests through `common::testdata(name)` in Rust, `repo('data/fixtures/<name>')` in Playwright and `testdata(name)` in Vitest.

## samples

`samples/manifest.json` maps each file name to its URL, pinned to a commit or a Zenodo record. `samples/README.md` lists what each graph shows, its source and its licence. Nothing in `samples/` is committed.

## Credits

Everything in `fixtures/` was written for GRAPE and is covered by the repository's licence, except:

- `csgA.fasta`: the _csgA_ gene of _Myxococcus xanthus_ DK 1622, NCBI nucleotide record [NC_008095.1](https://www.ncbi.nlm.nih.gov/nuccore/NC_008095.1), bases 1520199 to 1520888. Sequence records in the International Nucleotide Sequence Database Collaboration are in the public domain.
- `search.gfa` holds random bases, not a real genome.

The sources and licences of the sample graphs are in [samples/README.md](samples/README.md). The four example graphs the app ships are credited in [web/public/examples/CREDITS.md](../web/public/examples/CREDITS.md).
