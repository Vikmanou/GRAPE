import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { failOnPageError, repo } from './helpers';

const testdata = (name: string) => repo(`testdata/${name}`);

async function open(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('open-input').setInputFiles(testdata(name));
}

test.beforeEach(({ page }) => {
  failOnPageError(page);
});

test('shows stats for a plain GFA file', async ({ page }) => {
  await open(page, 'linear.gfa');
  await expect(page.getByTestId('stat-segments')).toHaveText('3');
  await expect(page.getByTestId('stat-links')).toHaveText('2');
  await expect(page.getByTestId('stat-total-length')).toHaveText('30 bp');
  await expect(page.getByTestId('stat-n50')).toHaveText('10 bp');
  await expect(page.getByTestId('stat-dead-ends')).toHaveText('2');
  await expect(page.getByTestId('stat-mean-depth')).toHaveText('12.7×');
  await expect(page.getByTestId('format')).toContainText('GFA 1.0');
  await expect(page.getByTestId('file-name')).toContainText('linear.gfa');
  await expect(page.getByTestId('status-warnings')).toHaveCount(0);
});

test('decompresses gzip and bgzip', async ({ page }) => {
  await open(page, 'linear.gfa.gz');
  await expect(page.getByTestId('format')).toContainText('gzipped');
  await expect(page.getByTestId('stat-segments')).toHaveText('3');
  await expect(page.getByTestId('stat-total-length')).toHaveText('30 bp');

  await page.getByTestId('open-input').setInputFiles(testdata('bgzf.gfa.gz'));
  await expect(page.getByTestId('format')).toContainText('bgzipped');
  await expect(page.getByTestId('stat-segments')).toHaveText('7');
  await expect(page.getByTestId('stat-links')).toHaveText('6');
});

test('explains concatenated gzip that is not bgzip', async ({ page }) => {
  await open(page, 'two_members.gfa.gz');
  await expect(page.getByTestId('load-error')).toContainText('decompress it first');
});

test('reads FASTG', async ({ page }) => {
  await open(page, 'bubble.fastg');
  await expect(page.getByTestId('format')).toContainText('FASTG');
  await expect(page.getByTestId('stat-segments')).toHaveText('4');
  await expect(page.getByTestId('stat-links')).toHaveText('4');
});

test('lists warnings with line numbers', async ({ page }) => {
  await open(page, 'malformed.gfa');
  const button = page.getByTestId('status-warnings');
  await expect(button).toHaveText('13 warnings');
  await button.click();
  const panel = page.getByTestId('warnings-panel');
  await expect(panel.getByRole('listitem')).toHaveCount(13);
  await expect(panel.getByRole('listitem').first()).toContainText('line 2');
  await expect(panel).toContainText("Segment '1' is defined again");
});

test('rejects GFA 2 with a clear message', async ({ page }) => {
  await open(page, 'gfa2.gfa');
  await expect(page.getByTestId('load-error')).toContainText('GFA 2.0 is not supported');
});

test('accepts a file dropped on the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  const text = readFileSync(testdata('tangle.gfa'), 'utf8');
  const transfer = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], 'tangle.gfa'));
    return dt;
  }, text);
  await page.dispatchEvent('main', 'dragover', { dataTransfer: transfer });
  await page.dispatchEvent('main', 'drop', { dataTransfer: transfer });
  await expect(page.getByTestId('stat-segments')).toHaveText('7');
  await expect(page.getByTestId('stat-dead-ends')).toHaveText('6');
});
