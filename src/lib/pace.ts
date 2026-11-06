/**
 * Serialise requests to a rate-limited service: one at a time, with a minimum gap
 * between the end of one and the start of the next.
 */
export function createPacer(gapMs: () => number): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + gapMs() - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        last = Date.now();
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
