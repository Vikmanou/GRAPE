# Benchmarks

Written by `npm run bench:layout` on 2026-10-27: Intel(R) Core(TM) i5-10310U CPU @ 1.70GHz,
GPU intel gen-9, linux 6.19.10-300.fc44.x86_64, Playwright's Chromium.

## GPU layout against the CPU reference

Both use the same coarsening, seed (1) and iteration budget (Balanced); the
GPU replaces Barnes-Hut repulsion with the spatial grid. Edge CV is the
coefficient of variation of spring length over rest length, lower is
better; overlaps count points of different segments closer than 2.5 units.
The GPU passes when it is no more than 15% worse on both, with overlaps
also allowed 0.1% of the point count.

| Graph                            | Segments |  Points | Edge CV CPU | Edge CV GPU | Overlaps CPU | Overlaps GPU | Within tolerance |
| -------------------------------- | -------: | ------: | ----------: | ----------: | -----------: | -----------: | ---------------- |
| bacterial-spades.gfa             |      336 |   1,162 |       0.527 |       0.527 |            0 |            0 | yes              |
| mitochondrion-acacia-spades.gfa  |      161 |     601 |       0.484 |       0.485 |            0 |            0 | yes              |
| lpa-13-haplotypes.gfa            |    3,751 |  14,242 |       0.488 |       0.478 |            6 |            4 | yes              |
| potato-hifiasm-unitigs-noseq.gfa |   20,216 |  65,418 |       0.651 |       0.608 |           61 |           55 | yes              |
| 200000.gfa                       |  200,000 | 710,430 |       0.760 |       0.806 |        1,110 |        1,746 | yes              |

## 200k-segment synthetic graph against the spec targets

`gfa-gen --segments 200000`. Layout times count from opening the
file, parse included, with the time after parsing in brackets. First
usable: refined to level 3 and packed. Frame rates are what the GPU keeps
up with while panning and zooming every frame. Tab memory is the page's
renderer process (the page and its workers) after the layout settled;
Chromium's GPU process, shared by all tabs, is listed apart.

| Measure                 | Target  | Measured                      |
| ----------------------- | ------- | ----------------------------- |
| Parse                   | < 5 s   | 3.0 s                         |
| First usable layout     | < 15 s  | 13.5 s (10.6 s after parsing) |
| Settled layout          | < 60 s  | 36.9 s (33.9 s after parsing) |
| Interaction, zoomed in  | 60 fps  | 60 fps                        |
| Interaction, zoomed out | 30+ fps | 56 fps                        |
| Tab memory              | < 1 GB  | 364 MB (GPU process 216 MB)   |

Per level: GPU time from timestamp queries, wall time from the
level's first batch to the next level's.

| Level |   Nodes | Iterations |   GPU |   Wall |
| ----: | ------: | ---------: | ----: | -----: |
|    16 |     234 |        500 | 0.1 s |  0.2 s |
|    15 |     279 |        400 | 0.1 s |  0.0 s |
|    14 |     362 |        400 | 0.1 s |  0.1 s |
|    13 |     527 |        400 | 0.1 s |  0.1 s |
|    12 |     837 |        400 | 0.1 s |  0.1 s |
|    11 |   1,395 |        400 | 0.2 s |  0.3 s |
|    10 |   2,360 |        400 | 0.3 s |  0.3 s |
|     9 |   3,905 |        400 | 0.4 s |  0.4 s |
|     8 |   6,510 |        400 | 0.5 s |  0.7 s |
|     7 |  11,070 |        400 | 0.7 s |  0.7 s |
|     6 |  19,280 |        400 | 1.0 s |  1.2 s |
|     5 |  34,105 |        400 | 1.5 s |  1.6 s |
|     4 |  60,901 |        328 | 1.9 s |  2.4 s |
|     3 | 109,383 |        182 | 1.7 s |  2.1 s |
|     2 | 197,117 |        101 | 1.9 s |  2.7 s |
|     1 | 362,966 |        100 | 4.6 s |  8.7 s |
|     0 | 710,430 |         50 | 6.1 s | 10.4 s |

## Every graph

| Graph                            | Parse | First usable | Settled | Tab memory | GPU process | Zoomed out | Zoomed in |
| -------------------------------- | ----: | -----------: | ------: | ---------: | ----------: | ---------: | --------: |
| bacterial-spades.gfa             | 0.0 s |        1.0 s |   1.1 s |     268 MB |      172 MB |         60 |        60 |
| mitochondrion-acacia-spades.gfa  | 0.1 s |        0.5 s |   0.5 s |     271 MB |      174 MB |         60 |        60 |
| lpa-13-haplotypes.gfa            | 0.1 s |        1.0 s |   1.5 s |     279 MB |      176 MB |         60 |        60 |
| potato-hifiasm-unitigs-noseq.gfa | 1.3 s |        2.6 s |   3.8 s |     343 MB |      180 MB |         60 |        60 |
| 200000.gfa                       | 3.0 s |       10.6 s |  33.9 s |     364 MB |      216 MB |         56 |        60 |

## Memory against the budgets

What each part of the page holds once the layout settled, in MB, against
its budget in `scripts/memory-budgets.mjs`. Workers count their WASM memory
and the arrays they keep; the main thread its JS heap and its typed arrays.

| Graph                            |        Tab |         Main heap | Main arrays |       GPU | Graph worker | Sequence worker | Layout worker |
| -------------------------------- | ---------: | ----------------: | ----------: | --------: | -----------: | --------------: | ------------: |
| bacterial-spades.gfa             |  268 / 300 |           14 / 64 |       0 / 1 |    0 / 64 |       1 / 32 |          1 / 16 |        1 / 16 |
| mitochondrion-acacia-spades.gfa  |  271 / 300 |           14 / 64 |       0 / 1 |    0 / 64 |       2 / 32 |          1 / 16 |        1 / 16 |
| lpa-13-haplotypes.gfa            |  279 / 300 |           17 / 64 |       0 / 1 |    3 / 67 |       5 / 33 |          1 / 16 |        1 / 16 |
| potato-hifiasm-unitigs-noseq.gfa | 343 / 1024 |           26 / 66 |       0 / 2 |   13 / 77 |       5 / 38 |          1 / 17 |        1 / 16 |
| 200000.gfa                       | 364 / 1024 | 106 / 83 **over** |       3 / 9 | 153 / 198 |      28 / 89 |          5 / 24 |        1 / 16 |
