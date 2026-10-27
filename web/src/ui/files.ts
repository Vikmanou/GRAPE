/** Saves a blob through the browser's download prompt; nothing leaves the machine. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Copies text that is still being produced. Handing the clipboard a promise
 * keeps the click's user activation, which a long wait would otherwise lose.
 */
export async function copyText(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem === 'undefined') {
    await navigator.clipboard.writeText(await text);
    return;
  }
  const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
  await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
}
