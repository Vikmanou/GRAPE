# Interaction benchmarks

Written by `npm run bench:interaction` on 2026-10-27: Intel(R) Core(TM) i5-10310U CPU @ 1.70GHz,
linux 6.19.10-300.fc44.x86_64, Playwright's Chromium on the real GPU. Times run from the input event to the
engine's answer, measured in the page: median, maximum and count. Zoomed in is 30 wheel steps from the
fitted view. The find is a regex over every name. Tab memory is the page's renderer process after the
graph settled, then after the measurements.

| Graph       |  Segments | Zoomed out | Zoomed in | Hover                | Click to selection    | Box select            | Regex find | Tab memory     |
| ----------- | --------: | ---------: | --------: | -------------------- | --------------------- | --------------------- | ---------: | -------------- |
| 1000000.gfa | 1,000,000 |     15 fps |    45 fps | 2.6 ms (max 8.6, 20) | 5.4 ms (max 21.4, 20) | 30.6 ms (max 30.6, 1) |     757 ms | 2030 → 2076 MB |
