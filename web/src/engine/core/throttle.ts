/** Calls `run` at most once every `ms`, and once more after the last request. */
export function throttle(run: () => void, ms: number): { request(): void; cancel(): void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    request() {
      if (timer !== undefined) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          last = performance.now();
          run();
        },
        Math.max(0, last + ms - performance.now()),
      );
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
