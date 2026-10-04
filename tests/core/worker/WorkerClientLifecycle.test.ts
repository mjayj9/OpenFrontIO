import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "../../../src/core/worker/WorkerClient";
import type { WorkerMessage } from "../../../src/core/worker/WorkerMessages";

const workers = vi.hoisted(() => ({
  instances: [] as Array<{
    postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>;
    terminate: ReturnType<typeof vi.fn>;
    onMessage?: (event: MessageEvent<WorkerMessage>) => void;
  }>,
}));

vi.mock("../../../src/core/worker/Worker.worker.ts?worker&inline", () => ({
  default: class {
    postMessage = vi.fn<(message: unknown) => void>();
    terminate = vi.fn();
    onMessage?: (event: MessageEvent<WorkerMessage>) => void;
    constructor() {
      workers.instances.push(this);
    }
    addEventListener(
      _type: string,
      callback: (event: MessageEvent<WorkerMessage>) => void,
    ) {
      this.onMessage = callback;
    }
  },
}));
vi.mock("../../../src/core/AssetUrls", () => ({
  getWorkerCdnBase: () => "https://example.com/",
}));

describe("WorkerClient lifecycle", () => {
  beforeEach(() => {
    workers.instances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function waitForInitRequest() {
    await vi.waitFor(() => {
      expect(workers.instances[0]?.postMessage).toHaveBeenCalledOnce();
    });
    return workers.instances[0];
  }

  it("terminates a worker loaded after the game has been closed", async () => {
    const client = new WorkerClient({} as never, undefined);
    const initialization = client.initialize();
    const rejected = expect(initialization).rejects.toThrow(
      "Worker initialization cancelled",
    );

    client.cleanup();
    await rejected;

    expect(workers.instances).toHaveLength(1);
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(workers.instances[0].postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects pending initialization immediately and ignores late responses", async () => {
    const client = new WorkerClient({} as never, undefined);
    const initialization = client.initialize();
    const rejected = expect(initialization).rejects.toThrow(
      "Worker initialization cancelled",
    );
    const worker = await waitForInitRequest();
    const request = worker.postMessage.mock.calls[0][0] as { id: string };

    client.cleanup();
    await rejected;
    worker.onMessage?.({
      data: { type: "initialized", id: request.id },
    } as MessageEvent<WorkerMessage>);

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => client.sendTurn({} as never)).toThrow(
      "Worker not initialized",
    );
    await expect(client.initialize()).rejects.toThrow(
      "Worker initialization cancelled",
    );
    expect(workers.instances).toHaveLength(1);
  });

  it("clears the initialization watchdog on success and disposes once", async () => {
    const client = new WorkerClient({} as never, undefined);
    const initialization = client.initialize();
    const worker = await waitForInitRequest();
    const request = worker.postMessage.mock.calls[0][0] as { id: string };
    const initialView = { updates: {} };

    worker.onMessage?.({
      data: { type: "initialized", id: request.id, initialView },
    } as MessageEvent<WorkerMessage>);
    await initialization;
    expect(client.initialView).toEqual(initialView);
    expect(vi.getTimerCount()).toBe(0);

    client.sendTurn({ turnNumber: 0, intents: [] });
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    client.cleanup();
    client.cleanup();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(() => client.sendTurn({} as never)).toThrow(
      "Worker not initialized",
    );
  });

  it("terminates and clears the watchdog when initialization times out", async () => {
    const client = new WorkerClient({} as never, undefined);
    const initialization = client.initialize();
    const rejected = expect(initialization).rejects.toThrow(
      "Worker initialization timeout",
    );
    const worker = await waitForInitRequest();

    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    client.cleanup();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
