# Benchmarks

Written by `npm run bench:layout` on 2026-11-16: AMD Ryzen 9 9950X 16-Core Processor ,
GPU nvidia blackwell, win32 10.0.26200, Playwright's Chromium.

## GPU layout against the CPU reference

Both use the same coarsening, seed (1) and iteration budget (Balanced); the
GPU replaces Barnes-Hut repulsion with the spatial grid. Edge CV is the
coefficient of variation of spring length over rest length, lower is
better; overlaps count points of different segments closer than 2.5 units.
The GPU passes when it is no more than 15% worse on both, with overlaps
also allowed 0.1% of the point count.

| Graph                            |  Segments |    Points | Edge CV CPU | Edge CV GPU | Overlaps CPU | Overlaps GPU | Within tolerance  |
| -------------------------------- | --------: | --------: | ----------: | ----------: | -----------: | -----------: | ----------------- |
| bacterial-spades.gfa             |       336 |     1,162 |       0.528 |       0.528 |            0 |            1 | yes               |
| mitochondrion-acacia-spades.gfa  |       161 |       601 |       0.483 |       0.485 |            0 |            0 | yes               |
| lpa-13-haplotypes.gfa            |     3,751 |    14,242 |       0.488 |       0.479 |            6 |            7 | yes               |
| potato-hifiasm-unitigs-noseq.gfa |    20,216 |    65,418 |       0.651 |       0.609 |           63 |           48 | yes               |
| 200000.gfa                       |   200,000 |   710,430 |       0.760 |       0.806 |        1,122 |        1,705 | yes               |
| 1000000.gfa                      | 1,000,000 | 3,552,043 |       0.851 |       0.859 |       10,744 |       57,984 | **no** (overlaps) |

## 200k-segment synthetic graph against the spec targets

`gfa-gen --segments 200000`. Layout times count from opening the
file, parse included, with the time after parsing in brackets. First
usable: refined to level 3 and packed. Frame rates are what the GPU keeps
up with while panning and zooming every frame. Tab memory is the page's
renderer process (the page and its workers) after the layout settled;
Chromium's GPU process, shared by all tabs, is listed apart.

| Measure                 | Target  | Measured                    |
| ----------------------- | ------- | --------------------------- |
| Parse                   | < 5 s   | 0.2 s                       |
| First usable layout     | < 15 s  | 1.5 s (1.3 s after parsing) |
| Settled layout          | < 60 s  | 1.8 s (1.5 s after parsing) |
| Interaction, zoomed in  | 60 fps  | 60 fps                      |
| Interaction, zoomed out | 30+ fps | 60 fps                      |
| Tab memory              | < 1 GB  | 388 MB (GPU process 343 MB) |

Per level: GPU time from timestamp queries, wall time from the
level's first batch to the next level's.

| Level |   Nodes | Iterations |   GPU |  Wall |
| ----: | ------: | ---------: | ----: | ----: |
|    16 |     234 |        500 | 0.0 s | 0.2 s |
|    15 |     279 |        400 | 0.0 s | 0.1 s |
|    14 |     362 |        400 | 0.0 s | 0.1 s |
|    13 |     527 |        400 | 0.0 s | 0.1 s |
|    12 |     837 |        400 | 0.0 s | 0.1 s |
|    11 |   1,395 |        400 | 0.0 s | 0.1 s |
|    10 |   2,360 |        400 | 0.1 s | 0.1 s |
|     9 |   3,905 |        400 | 0.1 s | 0.1 s |
|     8 |   6,510 |        400 | 0.0 s | 0.1 s |
|     7 |  11,070 |        400 | 0.0 s | 0.1 s |
|     6 |  19,280 |        400 | 0.0 s | 0.1 s |
|     5 |  34,105 |        400 | 0.1 s | 0.1 s |
|     4 |  60,901 |        328 | 0.1 s | 0.1 s |
|     3 | 109,383 |        182 | 0.1 s | 0.0 s |
|     2 | 197,117 |        101 | 0.1 s | 0.0 s |
|     1 | 362,966 |        100 | 0.1 s | 0.1 s |
|     0 | 710,430 |         50 | 0.1 s | 0.2 s |

## 1M-segment synthetic graph against the spec targets

`gfa-gen --segments 1000000`. Layout times count from opening the
file, parse included, with the time after parsing in brackets. First
usable: refined to level 3 and packed. Frame rates are what the GPU keeps
up with while panning and zooming every frame. Tab memory is the page's
renderer process (the page and its workers) after the layout settled;
Chromium's GPU process, shared by all tabs, is listed apart.

| Measure                 | Target  | Measured                     |
| ----------------------- | ------- | ---------------------------- |
| Parse                   | < 20 s  | 1.2 s                        |
| First usable layout     | < 60 s  | 4.0 s (2.9 s after parsing)  |
| Settled layout          | < 180 s | 6.9 s (5.7 s after parsing)  |
| Interaction, zoomed in  | 30+ fps | 60 fps                       |
| Interaction, zoomed out | – fps   | 60 fps                       |
| Tab memory              | < 2 GB  | 1103 MB (GPU process 539 MB) |

Per level: GPU time from timestamp queries, wall time from the
level's first batch to the next level's.

| Level |     Nodes | Iterations |   GPU |  Wall |
| ----: | --------: | ---------: | ----: | ----: |
|    19 |       268 |        500 | 0.0 s | 0.2 s |
|    18 |       298 |        400 | 0.0 s | 0.1 s |
|    17 |       358 |        400 | 0.0 s | 0.1 s |
|    16 |       473 |        400 | 0.0 s | 0.1 s |
|    15 |       703 |        400 | 0.0 s | 0.1 s |
|    14 |     1,153 |        400 | 0.0 s | 0.1 s |
|    13 |     2,035 |        400 | 0.0 s | 0.1 s |
|    12 |     3,713 |        400 | 0.2 s | 0.1 s |
|    11 |     6,713 |        400 | 0.2 s | 0.1 s |
|    10 |    11,636 |        400 | 0.2 s | 0.2 s |
|     9 |    19,505 |        400 | 0.1 s | 0.1 s |
|     8 |    32,675 |        400 | 0.2 s | 0.2 s |
|     7 |    55,592 |        359 | 0.2 s | 0.1 s |
|     6 |    96,690 |        206 | 0.1 s | 0.1 s |
|     5 |   171,013 |        116 | 0.1 s | 0.2 s |
|     4 |   305,403 |        100 | 0.2 s | 0.2 s |
|     3 |   547,401 |        100 | 0.3 s | 0.2 s |
|     2 |   986,095 |        100 | 0.4 s | 0.5 s |
|     1 | 1,815,309 |        100 | 0.8 s | 0.9 s |
|     0 | 3,552,043 |         50 | 1.3 s | 1.4 s |

## Every graph

| Graph                            | Parse | First usable | Settled | Tab memory | GPU process | Zoomed out | Zoomed in |
| -------------------------------- | ----: | -----------: | ------: | ---------: | ----------: | ---------: | --------: |
| bacterial-spades.gfa             | 0.0 s |        0.5 s |   0.7 s |     190 MB |      260 MB |         60 |        60 |
| mitochondrion-acacia-spades.gfa  | 0.0 s |        0.6 s |   0.6 s |     194 MB |      293 MB |         60 |        60 |
| lpa-13-haplotypes.gfa            | 0.0 s |        0.8 s |   0.9 s |     203 MB |      295 MB |         60 |        60 |
| potato-hifiasm-unitigs-noseq.gfa | 0.1 s |        0.9 s |   1.0 s |     271 MB |      286 MB |         60 |        60 |
| 200000.gfa                       | 0.2 s |        1.3 s |   1.5 s |     388 MB |      343 MB |         60 |        60 |
| 1000000.gfa                      | 1.2 s |        2.9 s |   5.7 s |    1103 MB |      539 MB |         60 |        60 |

## Memory against the budgets

What each part of the page holds once the layout settled, in MB, against
its budget in `scripts/bench/memory-budgets.mjs`. Workers count their WASM memory
and the arrays they keep; the main thread its JS heap and its typed arrays.

| Graph                            |         Tab | Main heap | Main arrays |       GPU | Graph worker | Sequence worker | Layout worker |
| -------------------------------- | ----------: | --------: | ----------: | --------: | -----------: | --------------: | ------------: |
| bacterial-spades.gfa             |   190 / 300 |   15 / 64 |       0 / 1 |    0 / 64 |       1 / 32 |          1 / 16 |        1 / 16 |
| mitochondrion-acacia-spades.gfa  |   194 / 300 |   16 / 64 |       0 / 1 |    0 / 64 |       2 / 32 |          1 / 16 |        1 / 16 |
| lpa-13-haplotypes.gfa            |   203 / 300 |   16 / 64 |       0 / 1 |    2 / 67 |       5 / 33 |          1 / 16 |        1 / 16 |
| potato-hifiasm-unitigs-noseq.gfa |  271 / 1024 |   19 / 66 |       1 / 2 |    9 / 77 |       5 / 38 |          1 / 17 |        1 / 16 |
| 200000.gfa                       |  388 / 1024 |   34 / 83 |       5 / 9 |  95 / 198 |      32 / 89 |          5 / 24 |        1 / 16 |
| 1000000.gfa                      | 1103 / 2048 | 109 / 159 |     25 / 39 | 473 / 732 |    158 / 318 |         21 / 54 |        1 / 16 |

## With the search index

One sequence search builds the index; its memory is held by the sequence worker.
Tab memory is held against the spec target for the graph size.

| Graph                           | Tab before |       Tab with index | Sequence worker before | Sequence worker with index |
| ------------------------------- | ---------: | -------------------: | ---------------------: | -------------------------: |
| bacterial-spades.gfa            |     190 MB |            220 / 300 |                   1 MB |                       2 MB |
| mitochondrion-acacia-spades.gfa |     194 MB |            226 / 300 |                   1 MB |                       5 MB |
| lpa-13-haplotypes.gfa           |     203 MB |            236 / 300 |                   1 MB |                       2 MB |
| 200000.gfa                      |     388 MB | 1453 / 1024 **over** |                   5 MB |                    1080 MB |
| 1000000.gfa                     |    1103 MB |          1619 / 2048 |                  21 MB |                     957 MB |
