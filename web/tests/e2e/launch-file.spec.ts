// A file the operating system hands to the installed app (the manifest's
// file_handlers) reaches the page through window.launchQueue and opens like a
// picked file. The browser's own part, matching the file and asking the user,
// cannot run here: a stand-in queue hands the page a real file handle from the
// origin's private file system instead.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { repo } from './helpers';

test('a file handed over by the operating system opens in the app', async ({ page }) => {
  await page.addInitScript(() => {
    type Consumer = (params: { files: FileSystemHandle[] }) => void;
    const w = window as unknown as { launchQueue: { setConsumer(c: Consumer): void }; launchConsumer?: Consumer };
    // Chromium's own queue is a read-only property of window, so it is replaced, not assigned.
    Object.defineProperty(window, 'launchQueue', {
      value: {
        setConsumer: (consumer: Consumer) => {
          w.launchConsumer = consumer;
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');

  const text = readFileSync(repo('testdata/linear.gfa'), 'utf8');
  await page.evaluate(async (text) => {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle('linear.gfa', { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    const w = window as unknown as { launchConsumer?: (params: { files: FileSystemHandle[] }) => void };
    if (!w.launchConsumer) throw new Error('the app did not take the launch queue');
    w.launchConsumer({ files: [handle] });
  }, text);

  await expect(page.getByTestId('file-name')).toContainText('linear.gfa');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done');
});
