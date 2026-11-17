# Browser checks

What was checked in which browser before release, and what is still open.
Chromium and Firefox run in the test suite; Edge and Safari have to be tried by
hand on a real machine.

## Automated

| Browser          | What runs                                                            | Where                                 |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------- |
| Chromium, WebGL2 | every flow and the screenshot baselines                              | `npm run check`, CI                   |
| Chromium, WebGPU | every flow, GPU kernels and layout                                   | `npm run check:headed`, on a real GPU |
| Firefox          | the packed share link                                                | `npm run check`                       |
| Chromium         | the site opens and opens a file with no network after one visit      | `tests/e2e/offline.spec.ts`           |
| Chromium         | every control has a name, ids are unique, focus is outlined          | `tests/e2e/a11y.spec.ts`              |
| Chromium         | the build is installable; manifest images have their sizes, offline  | `tests/e2e/install.spec.ts`           |
| Chromium         | text contrast 4.5:1 and control borders 3:1 in both themes           | `tests/unit/tokens.test.ts`           |
| Chromium         | 200% zoom: every control in the tabs, menus and info panel reachable | `tests/e2e/zoom.spec.ts`              |

## By hand

Open the live site, then do this in each browser. Tick it off when it works.
GRAPE needs Safari 16.4 or later (WASM SIMD, decisions.md 2026-10-24), so
older Safari is not supported. Lines ticked by Claude were driven on
2026-11-17 through Playwright on the live site, on the Windows 11 desktop
(RTX 5060); see decisions.md, milestone 16.

- [x] Edge on Windows (WebGPU): open an example, watch it settle, select a segment, find by name, export a PNG. Edge 157.0.4341.60, WebGPU.
- [ ] Safari 26 on macOS (WebGPU) and Safari 16.4 to 18 (WebGL2): the same list. No Mac available; not checked.
- [ ] Safari on iPadOS or iOS: the same list, on WebGPU and on WebGL2 (`?renderer=webgl2`). WebGL2 draws correctly on the owner's iPad (2026-11-17); the rest not checked, by the owner's decision (decisions.md 2026-11-17).
- [x] Firefox on Windows (WebGPU) and on Linux (WebGL2): the same list, then open a share link. Firefox 157.0 on Windows (WebGPU) and Firefox 157.0 on Ubuntu under WSL 2 (WebGL2); a 269,958 character link opened in both.
- [x] Offline: open the site, turn off the network, reload, open a file from the disk. Edge 157, Firefox 157 on Windows and Linux: reload and an example with the network off.
- [x] Screen reader (VoiceOver or NVDA): open a file, move through the four tabs, hear a selection's details. NVDA 2026.3.1 with Edge 157; Home and End on the tabs and the selection announcement were added after this check.
- [x] 200% zoom and a 390 px wide window: nothing is cut off and every action is reachable. `zoom.spec.ts` and `narrow.spec.ts`; the Export menu was cut off at 200% of 1920 by 1080 and now scrolls.

Not a browser GRAPE supports: Playwright's WebKit 27.2 on Windows draws the
WebGL2 path wrongly, while Safari draws it correctly (decisions.md).

Safari's share-link size limit: not measured.

### Installed app (milestone 15)

Install from the live site, then open the app from its icon. Note the browser
version beside each line.

- [ ] Chrome or Edge on Windows, macOS or Linux: Install from the address bar shows the larger dialog with the two screenshots; the app opens in its own window with the GRAPE icon and title bar colour. Not checked, by the owner's decision (decisions.md 2026-11-17).
- [ ] Chrome on Android: Add to Home screen or Install; the icon is not cropped in a round or squircle mask. Not checked, by the owner's decision (decisions.md 2026-11-17).
- [ ] Safari on macOS (File, Add to Dock) and on iOS or iPadOS (Share, Add to Home Screen): the icon shows on the cream backdrop, not on black. Not checked, by the owner's decision (decisions.md 2026-11-17).
- [x] Offline from a cold start: quit the app, turn off the network, open it from the icon, open an example. Chrome 113 on the Android emulator and Edge 157 on Windows (milestone 15).
- [x] Update: after a new version is deployed, the app shows it once every app window has been closed and opened again, as a browser tab does. Edge 157 on Windows (milestone 15).
- [ ] File handler (Chrome or Edge on Windows, macOS and Linux): Open with, GRAPE on a `.gfa`, a `.gfa.gz` and a `.fastg` file opens each in the app after allowing the file types once; note whether `.gfa.gz` is listed at all. On Linux, GRAPE is not offered for an unrelated file such as a `.zip`. DevTools, Network shows no upload. Not checked, by the owner's decision (decisions.md 2026-11-17).