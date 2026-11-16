# Browser checks

What was checked in which browser before release, and what is still open.
Chromium and Firefox run in the test suite; Edge and Safari have to be tried by
hand on a real machine.

## Automated

| Browser          | What runs                                                       | Where                                 |
| ---------------- | --------------------------------------------------------------- | ------------------------------------- |
| Chromium, WebGL2 | every flow and the screenshot baselines                         | `npm run check`, CI                   |
| Chromium, WebGPU | every flow, GPU kernels and layout                              | `npm run check:headed`, on a real GPU |
| Firefox          | the packed share link                                           | `npm run check`                       |
| Chromium         | the site opens and opens a file with no network after one visit | `tests/e2e/offline.spec.ts`           |
| Chromium         | every control has a name, ids are unique, focus is outlined     | `tests/e2e/a11y.spec.ts`              |
| Chromium         | text contrast 4.5:1 and control borders 3:1 in both themes      | `tests/unit/tokens.test.ts`           |

## By hand

Open the live site, then do this in each browser. Tick it off when it works.

- [ ] Edge on Windows (WebGPU): open an example, watch it settle, select a segment, find by name, export a PNG.
- [ ] Safari 26 on macOS (WebGPU) and Safari 15 to 18 (WebGL2): the same list.
- [ ] Firefox on Windows (WebGPU) and on Linux (WebGL2): the same list, then open a share link.
- [ ] Offline: open the site, turn off the network, reload, open a file from the disk.
- [ ] Screen reader (VoiceOver or NVDA): open a file, move through the four tabs, hear a selection's details.
- [ ] 200% zoom and a 390 px wide window: nothing is cut off and every action is reachable.
