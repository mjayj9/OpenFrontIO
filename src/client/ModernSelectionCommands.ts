function validateBatchSize(size: number): void {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError("Batch size must be a positive integer");
}

/** The UI can select more than a network Intent's maximum unit count. Send
 * unique IDs in a stable order without weakening the existing Intent limit. */
export function stableChunks(ids: readonly string[], size = 32): string[][] {
  validateBatchSize(size);
  const sorted = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const chunks: string[][] = [];
  for (let offset = 0; offset < sorted.length; offset += size)
    chunks.push(sorted.slice(offset, offset + size));
  return chunks;
}

/** Bound worker preview requests without changing the selection. Keep the
 * caller's input/result order even when requests finish in a different order.
 * The caller supplies its cursor/selection revision guard; obsolete results
 * are discarded and never launch another batch. This is render/UI scheduling,
 * and must never decide which simulation commands are allowed. */
export async function queryPreviewBatches<Item, Result>(
  items: readonly Item[],
  query: (item: Item) => Promise<Result>,
  canContinue: () => boolean,
  batchSize = 8,
): Promise<Result[] | null> {
  validateBatchSize(batchSize);
  if (!canContinue()) return null;
  const results: Result[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    if (!canContinue()) return null;
    const batch = await Promise.all(
      items.slice(offset, offset + batchSize).map(query),
    );
    if (!canContinue()) return null;
    results.push(...batch);
  }
  return results;
}
