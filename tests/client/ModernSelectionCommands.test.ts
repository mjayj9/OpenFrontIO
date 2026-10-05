import { describe, expect, it, vi } from "vitest";
import {
  queryPreviewBatches,
  stableChunks,
} from "../../src/client/ModernSelectionCommands";

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("selection larger than an Intent", () => {
  it("keeps all 37 unique IDs in stable 32+5 commands, without locale collation", () => {
    const ids = Array.from(
      { length: 37 },
      (_, i) => `force-${String(i).padStart(2, "0")}`,
    );
    const chunks = stableChunks([...ids].reverse().concat(ids.slice(2, 9)));
    expect(chunks.map((chunk) => chunk.length)).toEqual([32, 5]);
    expect(chunks.flat()).toEqual(ids);
    expect(stableChunks(["z", "Z", "é", "e", "Z"]).flat()).toEqual([
      "Z",
      "e",
      "z",
      "é",
    ]);
  });

  it("rejects invalid limits and handles an empty selection", () => {
    expect(stableChunks([])).toEqual([]);
    expect(() => stableChunks(["a"], 0)).toThrow(RangeError);
    expect(() => stableChunks(["a"], 1.5)).toThrow(RangeError);
  });
});

describe("bounded latest cursor previews", () => {
  it("resolves all 37 results in selection order with at most eight in flight", async () => {
    const items = Array.from({ length: 37 }, (_, i) => i);
    const pending = new Map<number, ReturnType<typeof deferred<number>>>();
    let maximum = 0;
    const query = vi.fn((item: number) => {
      const result = deferred<number>();
      pending.set(item, result);
      maximum = Math.max(maximum, pending.size);
      return result.promise;
    });
    const output = queryPreviewBatches(items, query, () => true);
    while (query.mock.calls.length < items.length || pending.size) {
      // Finish each batch backwards to prove completion order does not change
      // which selected force receives each preview.
      for (const [item, result] of [...pending].reverse()) {
        pending.delete(item);
        result.resolve(item * 10);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(maximum).toBeLessThanOrEqual(8);
    expect(query).toHaveBeenCalledTimes(37);
    expect(await output).toEqual(items.map((item) => item * 10));
  });

  it("drops a late cursor response and never requests the remaining forces", async () => {
    const pending: ReturnType<typeof deferred<number>>[] = [];
    let revision = 1;
    const query = vi.fn(() => {
      const result = deferred<number>();
      pending.push(result);
      return result.promise;
    });
    const output = queryPreviewBatches(
      Array.from({ length: 37 }, (_, i) => i),
      query,
      () => revision === 1,
    );
    expect(query).toHaveBeenCalledTimes(8);
    revision = 2; // Real caller changes this when the cursor/selection changes.
    pending.forEach((item) => item.resolve(1));
    expect(await output).toBeNull();
    expect(query).toHaveBeenCalledTimes(8);
  });

  it("does not request a preview when already cancelled", async () => {
    const query = vi.fn(async (id: number) => id);
    expect(await queryPreviewBatches([1, 2], query, () => false)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves errors instead of presenting a successful command preview", async () => {
    await expect(
      queryPreviewBatches(
        [1],
        async () => {
          throw new Error("worker unavailable");
        },
        () => true,
      ),
    ).rejects.toThrow("worker unavailable");
  });
});
