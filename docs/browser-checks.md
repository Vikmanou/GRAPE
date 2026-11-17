# Browser checks

What was checked in which browser before release, and what is still open.
Chromium and Firefox run in the test suite; Edge and Safari have to be tried by
hand on a real machine.

## Automated

| Browser          | What runs                                                           | Where                                 |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Chromium, WebGL2 | every flow and the screenshot baselines                             | `npm run check`, CI                   |
| Chromium, WebGPU | every flow, GPU kernels and layout                                  | `npm run check:headed`, on a real GPU |
| Firefox          | the packed share link                                               | `npm run check`                       |
| Chromium         | the site opens and opens a file with no network after one visit     | `tests/e2e/offline.spec.ts`           |
| Chromium         | every control has a name, ids are unique, focus is outlined         | `tests/e2e/a11y.spec.ts`              |
| Chromium         | the build is installable; manifest images have their sizes, offline | `tests/e2e/install.spec.ts`           |
| Chromium         | text contrast 4.5:1 and control borders 3:1 in both themes          | `tests/unit/tokens.test.ts`           |

## By hand

Open the live site, then do this in each browser. Tick it off when it works.

- [ ] Edge on Windows (WebGPU): open an example, watch it settle, select a segment, find by name, export a PNG.
- [ ] Safari 26 on macOS (WebGPU) and Safari 15 to 18 (WebGL2): the same list.
- [ ] Firefox on Windows (WebGPU) and on Linux (WebGL2): the same list, then open a share link.
- [ ] Offline: open the site, turn off the network, reload, open a file from the disk.
- [ ] Screen reader (VoiceOver or NVDA): open a file, move through the four tabs, hear a selection's details.
- [ ] 200% zoom and a 390 px wide window: nothing is cut off and every action is reachable.

### Installed app (milestone 15)

Install from the live site, then open the app from its icon. Note the browser
version beside each line.

- [ ] Chrome or Edge on Windows, macOS or Linux: Install from the address bar shows the larger dialog with the two screenshots; the app opens in its own window with the GRAPE icon and title bar colour.
- [ ] Chrome on Android: Add to Home screen or Install; the icon is not cropped in a round or squircle mask.
- [ ] Safari on macOS (File, Add to Dock) and on iOS or iPadOS (Share, Add to Home Screen): the icon shows on the cream backdrop, not on black.
- [ ] Offline from a cold start: quit the app, turn off the network, open it from the icon, open an example.
- [ ] Update: after a new version is deployed, the app shows it once every app window has been closed and opened again, as a browser tab does.
- [ ] File handler (Chrome or Edge on Windows, macOS and Linux): Open with, GRAPE on a `.gfa`, a `.gfa.gz` and a `.fastg` file opens each in the app after allowing the file types once; note whether `.gfa.gz` is listed at all. On Linux, GRAPE is not offered for an unrelated file such as a `.zip`. DevTools, Network shows no upload.
