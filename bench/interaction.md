# Interaction benchmarks

Written by `npm run bench:interaction` on 2026-11-16: AMD Ryzen 9 9950X 16-Core Processor ,
win32 10.0.26200, Playwright's Chromium on the real GPU. Times run from the input event to the
engine's answer, measured in the page: median, maximum and count. Zoomed in is 30 wheel steps from the
fitted view. The find is a regex over every name. Tab memory is the page's renderer process after the
graph settled, then after the measurements.

| Graph       |  Segments | Zoomed out | Zoomed in | Hover                 | Click to selection   | Box select          | Regex find | Tab memory    |
| ----------- | --------: | ---------: | --------: | --------------------- | -------------------- | ------------------- | ---------: | ------------- |
| 200000.gfa  |   200,000 |     60 fps |    60 fps | 3.6 ms (max 30.1, 6)  | 3.3 ms (max 4.2, 6)  | 2.9 ms (max 2.9, 1) |      19 ms | 386 → 388 MB  |
| 1000000.gfa | 1,000,000 |     60 fps |    60 fps | 3.7 ms (max 11.5, 11) | 3.1 ms (max 4.3, 11) | 5.9 ms (max 5.9, 1) |      59 ms | 1112 → 835 MB |
