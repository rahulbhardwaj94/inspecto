/**
 * Runs fn over items with at most `limit` concurrent in-flight promises.
 * Returns settled results in input order, matching Promise.allSettled semantics.
 * One rejection never aborts the remaining items.
 */
export async function concurrentSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (error) {
        results[i] = { status: "rejected", reason: error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
