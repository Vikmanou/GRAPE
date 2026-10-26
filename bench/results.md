# Benchmarks

Written by `npm run bench:layout` on 2026-10-26: Intel(R) Core(TM) i5-10310U CPU @ 1.70GHz,
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
| bacterial-spades.gfa             |      336 |   1,162 |       0.517 |       0.529 |            3 |            0 | yes              |
| mitochondrion-acacia-spades.gfa  |      161 |     601 |       0.517 |       0.518 |            0 |            0 | yes              |
| lpa-13-haplotypes.gfa            |    3,751 |  14,242 |       0.456 |       0.400 |           16 |            2 | yes              |
| potato-hifiasm-unitigs-noseq.gfa |   20,216 |  65,418 |       0.639 |       0.605 |           57 |           44 | yes              |
| 200000.gfa                       |  200,000 | 710,430 |       0.725 |       0.762 |        1,059 |        1,676 | yes              |

## 200k-segment synthetic graph against the spec targets

`gfa-gen --segments 200000`, 191 MB. Layout times count from opening the
file, parse included, with the time after parsing in brackets. First
usable: refined to level 3 and packed. Frame rates are what the GPU keeps
up with while panning and zooming every frame. Tab memory is the page's
renderer process (the page and its workers) after the layout settled;
Chromium's GPU process, shared by all tabs, is listed apart.

| Measure                 | Target  | Measured                      |
| ----------------------- | ------- | ----------------------------- |
| Parse                   | < 5 s   | 2.4 s                         |
| First usable layout     | < 15 s  | 16.7 s (14.2 s after parsing) |
| Settled layout          | < 60 s  | 52.3 s (49.9 s after parsing) |
| Interaction, zoomed in  | 60 fps  | 60 fps                        |
| Interaction, zoomed out | 30+ fps | 55 fps                        |
| Tab memory              | < 1 GB  | 622 MB (GPU process 214 MB)   |

## Every graph

| Graph                            | Parse | First usable | Settled | Tab memory | GPU process | Zoomed out | Zoomed in |
| -------------------------------- | ----: | -----------: | ------: | ---------: | ----------: | ---------: | --------: |
| bacterial-spades.gfa             | 0.1 s |        0.9 s |   1.1 s |     261 MB |      171 MB |         60 |        60 |
| mitochondrion-acacia-spades.gfa  | 0.1 s |        1.0 s |   1.0 s |     264 MB |      170 MB |         59 |        56 |
| lpa-13-haplotypes.gfa            | 0.2 s |        1.6 s |   1.7 s |     273 MB |      173 MB |         59 |        60 |
| potato-hifiasm-unitigs-noseq.gfa | 1.3 s |        2.8 s |   4.0 s |     357 MB |      178 MB |         58 |        60 |
| 200000.gfa                       | 2.4 s |       14.2 s |  49.9 s |     622 MB |      214 MB |         55 |        60 |
