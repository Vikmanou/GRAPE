# Benchmarks against Bandage and BandageNG

From [bench/compare.md](../bench/compare.md); the layout and interaction
benchmarks of GRAPE alone are in [bench/results.md](../bench/results.md) and
[bench/interaction.md](../bench/interaction.md).

| Measure                                         |                      GRAPE |                   Bandage |                                                          BandageNG |
| ----------------------------------------------- | -------------------------: | ------------------------: | -----------------------------------------------------------------: |
| Open to a laid-out picture, 10k segments (s)    |         1.52 s (1.51–1.53) |        6.13 s (5.97–6.78) |                                             **0.87 s (0.86–0.92)** |
| Open to a laid-out picture, 50k segments (s)    |     **1.51 s (1.48–1.51)** |        32.9 s (31.7–33.6) |                                                 4.86 s (4.71–5.00) |
| Open to a laid-out picture, 200k segments (s)   |     **1.89 s (1.88–1.90)** |     131.7 s (131.1–135.1) |                                                 27.0 s (26.8–28.5) |
| Open to a laid-out picture, 1M segments (s)     |     **7.20 s (7.05–8.84)** |     900.8 s (834.7–998.4) |                                              178.7 s (174.7–187.9) |
| Peak memory at 200k segments (MB)               |       **766 MB (764–770)** |    2,496 MB (2,494–2,497) |                                             2,910 MB (2,910–2,911) |
| Peak memory at 1M segments (MB)                 | **2,003 MB (1,981–2,011)** | 12,666 MB (12,665–12,683) |                                          12,679 MB (11,156–12,687) |
| Largest graph laid out within 30 min (segments) |              **1,000,000** |             **1,000,000** |                                                      **1,000,000** |
| Export a PNG at 200k segments (s)               |         0.03 s (0.03–0.04) |    no layout-only command | within noise (image 27.0 s (26.8–28.5), layout 28.2 s (26.7–28.5)) |

| Example (segments)                |              GRAPE |                Bandage |              BandageNG |
| --------------------------------- | -----------------: | ---------------------: | ---------------------: |
| human-mito-minigraph (8)          | 0.63 s (0.60–0.63) | **0.03 s (0.02–0.10)** |     0.06 s (0.06–0.19) |
| mitochondrion-acacia-spades (161) | 0.95 s (0.94–0.97) | **0.11 s (0.11–0.13)** |     1.21 s (1.07–1.41) |
| chloroplast-acacia-unicycler (1)  | 0.60 s (0.58–0.62) | **0.03 s (0.03–0.03)** |     0.07 s (0.06–0.17) |
| bacterial-spades (336)            | 1.04 s (1.02–1.05) | **0.22 s (0.22–0.23)** |           did not open |
| lpa-13-haplotypes (3,751)         | 1.23 s (1.22–1.25) |     1.35 s (1.28–1.93) | **1.04 s (1.01–1.08)** |

Each value is the median of 5 runs, with the fastest and slowest in brackets;
the lowest value wins each row (the highest for the largest graph) and is in bold, and a
value within 5% of it ties and is bold too. A row marked pending is still missing runs or
mixes machines. "Did not finish" means most runs hit the 30 min cap or failed.

Versions: GRAPE adb35f8 (WebGPU layout, Balanced quality, seed 1, in Playwright's
Chromium headless on the real GPU), Bandage 0.9.0 (Linux AppImage under WSL 2, `--iter 2`, the
default) and BandageNG 2026.11.1 (Windows build, default layout, `--iter 2`). Machine:
AMD Ryzen 9 9950X 16-Core Processor, NVIDIA GeForce RTX 5060, 31 GB, win32 10.0.26200. Runs from 2026-11-17 to 2026-11-17 (UTC).

Open to a laid-out picture: GRAPE from choosing the file to the layout reported done,
timed in the page, with the page already loaded; Bandage and BandageNG the wall time of `image`
at the same size as GRAPE's PNG (1200 by 800), which starts the program, loads, lays out
and draws. Peak memory: GRAPE's renderer plus GPU process, each at its own peak working
set; BandageNG's peak working set; Bandage's maximum resident set from `/usr/bin/time -v`.
PNG export: GRAPE's `exportPng` of the settled view; BandageNG's `image` minus its `layout`;
Bandage 0.9.0 has no layout-only command, so its export cannot be timed apart.

Search by segment name is not compared: neither Bandage tool has it on the command line.
Pan and zoom have no counterpart there either; GRAPE keeps them smooth on the 1M graph
(frame rates in [bench/interaction.md](../bench/interaction.md)). The layouts differ (Bandage and
BandageNG lay out on the CPU with OGDF, GRAPE on the GPU), so judge the pictures below.

BandageNG's PNG export is its `image` time minus its `layout` time; at 200k the two overlap run
to run, so drawing the PNG costs less than their noise and gets no time of its own.

## Against Bandage

Draw time is the median open time of the table's runs: GRAPE to its first usable layout
(refined to level 3 and packed) and to the settled layout; Bandage and BandageNG to the
written image, the only picture they show.

| Graph                           | GRAPE first usable |      GRAPE settled |               Bandage |          BandageNG |
| ------------------------------- | -----------------: | -----------------: | --------------------: | -----------------: |
| bacterial-spades.gfa            | 0.56 s (0.55–0.56) | 1.04 s (1.02–1.05) |    0.22 s (0.22–0.23) |       did not open |
| mitochondrion-acacia-spades.gfa | 0.55 s (0.53–0.56) | 0.95 s (0.94–0.97) |    0.11 s (0.11–0.13) | 1.21 s (1.07–1.41) |
| lpa-13-haplotypes.gfa           | 0.84 s (0.82–0.85) | 1.23 s (1.22–1.25) |    1.35 s (1.28–1.93) | 1.04 s (1.01–1.08) |
| 200000.gfa                      | 1.54 s (1.52–1.57) | 1.89 s (1.88–1.90) | 131.7 s (131.1–135.1) | 27.0 s (26.8–28.5) |

The same graph as each tool exports it, at 1200 by 800 pixels.

| Graph                           | GRAPE                                                                                                  | Bandage                                                                                                    | BandageNG                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| bacterial-spades.gfa            | ![bacterial-spades.gfa in grape](screenshots/bandage/bacterial-spades-grape.png)                       | ![bacterial-spades.gfa in bandage](screenshots/bandage/bacterial-spades-bandage.png)                       | did not open                                                                                                   |
| mitochondrion-acacia-spades.gfa | ![mitochondrion-acacia-spades.gfa in grape](screenshots/bandage/mitochondrion-acacia-spades-grape.png) | ![mitochondrion-acacia-spades.gfa in bandage](screenshots/bandage/mitochondrion-acacia-spades-bandage.png) | ![mitochondrion-acacia-spades.gfa in bandageng](screenshots/bandage/mitochondrion-acacia-spades-bandageng.png) |
| lpa-13-haplotypes.gfa           | ![lpa-13-haplotypes.gfa in grape](screenshots/bandage/lpa-13-haplotypes-grape.png)                     | ![lpa-13-haplotypes.gfa in bandage](screenshots/bandage/lpa-13-haplotypes-bandage.png)                     | ![lpa-13-haplotypes.gfa in bandageng](screenshots/bandage/lpa-13-haplotypes-bandageng.png)                     |
| 200000.gfa                      | ![200000.gfa in grape](screenshots/bandage/200000-grape.png)                                           | ![200000.gfa in bandage](screenshots/bandage/200000-bandage.png)                                           | ![200000.gfa in bandageng](screenshots/bandage/200000-bandageng.png)                                           |

Where GRAPE draws worse: its PNG keeps the whole canvas, while the fitted view leaves room
for the sidebar, so the left third of each picture is empty; Bandage and BandageNG fill theirs.

The GFA of the same segments, compared byte for byte with GRAPE's: the first 20
segments selected in GRAPE against each tool's `reduce --scope aroundnodes --distance 0`
over their names, and the whole graph against `reduce` with no scope.

| Graph                           | Selection, Bandage | Selection, BandageNG                 | Whole graph, Bandage                    | Whole graph, BandageNG                     |
| ------------------------------- | ------------------ | ------------------------------------ | --------------------------------------- | ------------------------------------------ |
| bacterial-spades.gfa            | identical          | did not open                         | same lines in another order (789 lines) | did not open                               |
| mitochondrion-acacia-spades.gfa | identical          | differs (53 of 55 lines unmatched)   | identical                               | differs (711 of 713 lines unmatched)       |
| lpa-13-haplotypes.gfa           | identical          | differs (103 of 105 lines unmatched) | identical                               | differs (18078 of 18080 lines unmatched)   |
| 200000.gfa                      | identical          | differs (78 of 80 lines unmatched)   | identical                               | differs (840203 of 840205 lines unmatched) |

Why they differ. Bandage: on bacterial-spades one pair of links that its `compareEdgePointers`
ranks equal (same start and end numbers, other signs) comes out in the other order; Bandage
leaves such ties to an unstable sort over its node pointers, and GRAPE orders them by the signed
end name (docs/decisions.md). BandageNG writes its own GFA: segments in hash order, P lines,
links that are not in the input (173 more on lpa-13-haplotypes), and on the mitochondrion no
sequences or depths after it rejects Bandage's lowercase `z` tags. It cannot open
bacterial-spades at all: SPAdes P lines step over scaffold gaps, which it calls malformed.
