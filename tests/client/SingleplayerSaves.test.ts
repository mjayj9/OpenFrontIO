// @vitest-environment node
import {
  deleteSave,
  exportSave,
  importSave,
  listSaves,
  readSave,
  resumeSave,
  saveBuild,
  SavedGame,
  writeSave,
} from "../../src/client/SingleplayerSaves";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "../../src/core/game/GameUpdates";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
} from "../../src/core/GameRunner";
import {
  GameStartInfo,
  GameStartInfoSchema,
  Turn,
} from "../../src/core/Schemas";
import {
  compressSnapshot,
  decompressSnapshot,
} from "../../src/core/snapshot/GameSnapshot";
import {
  decodeSnapshotValue,
  encodeSnapshotValue,
} from "../../src/core/snapshot/SnapshotCodec";
import { TestDataMapLoader } from "../util/ScriptedGame";
import { diffSnapshots } from "../util/Snapshot";
import { TRAINING_LOADER, TRAINING_START } from "../util/TrainingFixture";

/** Minimal async transaction double. Core snapshots and gzip are real.
 * The root browser verification covers the browser's actual IndexedDB engine. */
class TransactionalStorage {
  records = new Map<string, unknown>();
  abortNextWrite = false;
  private created = false;
  readonly indexedDB = {
    open: () => {
      const request = {} as IDBOpenDBRequest;
      const db = {
        close: () => {},
        createObjectStore: () => {},
        transaction: (_name: string, mode: IDBTransactionMode) => {
          const transaction = {} as IDBTransaction;
          const operation = (
            run: () => { result: unknown; commit?: () => void },
          ) => {
            const query = {} as IDBRequest;
            queueMicrotask(() => {
              if (mode === "readwrite" && this.abortNextWrite) {
                this.abortNextWrite = false;
                Object.defineProperty(transaction, "error", {
                  value: new DOMException(
                    "Simulated storage quota",
                    "QuotaExceededError",
                  ),
                });
                transaction.onabort?.call(transaction, new Event("abort"));
                return;
              }
              const output = run();
              Object.defineProperty(query, "result", { value: output.result });
              query.onsuccess?.call(query, new Event("success"));
              queueMicrotask(() => {
                output.commit?.();
                transaction.oncomplete?.call(
                  transaction,
                  new Event("complete"),
                );
              });
            });
            return query;
          };
          const store = {
            put: (value: { id: string }) =>
              operation(() => {
                const copy = structuredClone(value);
                return {
                  result: value.id,
                  commit: () => this.records.set(value.id, copy),
                };
              }),
            get: (id: string) =>
              operation(() => ({
                result: structuredClone(this.records.get(id)),
              })),
            getAll: () =>
              operation(() => ({
                result: structuredClone([...this.records.values()]),
              })),
            delete: (id: string) =>
              operation(() => ({
                result: undefined,
                commit: () => this.records.delete(id),
              })),
          };
          Object.assign(transaction, { objectStore: () => store });
          return transaction;
        },
      };
      Object.defineProperty(request, "result", { value: db });
      queueMicrotask(() => {
        if (!this.created) {
          this.created = true;
          request.onupgradeneeded?.call(
            request,
            new Event("upgradeneeded") as IDBVersionChangeEvent,
          );
        }
        request.onsuccess?.call(request, new Event("success"));
      });
      return request;
    },
  };
}

const CLIENT = "SAVETEST";
const start: GameStartInfo = {
  gameID: "SAVEGAME",
  lobbyCreatedAt: 0,
  players: [
    {
      clientID: CLIENT,
      username: "Save test",
      clanTag: null,
      isLobbyCreator: true,
    },
  ],
  config: {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    bots: 0,
    donateGold: true,
    donateTroops: true,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  },
};
let fixture: SavedGame;
let storage: TransactionalStorage;
let page: EventTarget;
let exported: Blob | undefined;
beforeAll(async () => {
  let tickError: ErrorUpdate | null = null;
  const runner = await createGameRunner(
    start,
    CLIENT,
    new TestDataMapLoader("plains"),
    (update) => {
      if ("errMsg" in update) tickError = update;
    },
  );
  const turns: Turn[] = [];
  for (let i = 0; i < 8; i++) {
    const turn: Turn = {
      turnNumber: i,
      intents:
        i === 1
          ? [{ type: "spawn", tile: runner.game.ref(50, 50), clientID: CLIENT }]
          : [],
    };
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick())
      throw new Error(`Save fixture failed: ${tickError}`);
  }
  expect(runner.game.playerByClientID(CLIENT)!.hasSpawned()).toBe(true);
  fixture = {
    format: 1,
    id: "manual",
    name: "Actual running game",
    createdAt: 1000,
    build: saveBuild,
    tick: runner.game.ticks(),
    gameStartInfo: start,
    snapshot: runner.snapshot(saveBuild),
    turns,
    education: { version: 1, completed: ["expand"], skipped: ["navy"] },
    ui: { attackRatio: 1 },
    paused: true,
  };
});
beforeEach(() => {
  storage = new TransactionalStorage();
  page = new EventTarget();
  exported = undefined;
  vi.stubGlobal("indexedDB", storage.indexedDB);
  vi.stubGlobal("document", {
    dispatchEvent: (event: Event) => page.dispatchEvent(event),
    createElement: () => ({ href: "", download: "", click: () => {} }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("stores actual compressed simulation plus complete turns, paused state and education", async () => {
  await writeSave(fixture);
  const saved = await readSave("manual");
  expect(saved.snapshot).toEqual(fixture.snapshot);
  expect(saved.turns).toEqual(fixture.turns);
  expect(saved.education).toEqual(fixture.education);
  expect(saved.ui).toEqual({ attackRatio: 1 });
  expect(saved.paused).toBe(true);
  const stored = storage.records.get("manual") as {
    snapshot?: unknown;
    compressed: Uint8Array;
  };
  expect(stored.snapshot).toBeUndefined();
  expect(stored.compressed.length).toBeLessThan(fixture.snapshot.length);
  expect(await listSaves()).toEqual([
    {
      id: "manual",
      name: fixture.name,
      createdAt: 1000,
      build: saveBuild,
      tick: 8,
    },
  ]);
  const restored = await createGameRunnerFromSnapshot(
    start,
    saved.snapshot,
    CLIENT,
    new TestDataMapLoader("plains"),
    () => {},
  );
  expect(diffSnapshots(restored.snapshot(saveBuild), fixture.snapshot)).toEqual(
    [],
  );
});

it("round trips a running dedicated training autosave through validation and restores its real prepared territory", async () => {
  expect(GameStartInfoSchema.safeParse(TRAINING_START).success).toBe(true);
  const errors: unknown[] = [];
  const onUpdate = (update: GameUpdateViewData | ErrorUpdate) => {
    if ("errMsg" in update) errors.push(update);
  };
  const runner = await createGameRunner(
    TRAINING_START,
    "Trainer1",
    TRAINING_LOADER,
    onUpdate,
  );
  const turns: Turn[] = [];
  for (let turnNumber = 0; turnNumber < 2; turnNumber++) {
    const turn = { turnNumber, intents: [] };
    turns.push(turn);
    runner.addTurn(turn);
    expect(runner.executeNextTick()).toBe(true);
  }
  const training: SavedGame = {
    format: 1,
    id: "training-autosave",
    name: "훈련 자동 저장",
    createdAt: 2000,
    build: saveBuild,
    tick: runner.game.ticks(),
    gameStartInfo: TRAINING_START,
    snapshot: runner.snapshot(saveBuild),
    turns,
    education: { panelVersion: 1, active: true, chapter: "basic" },
    ui: { attackRatio: 0.35 },
    paused: true,
  };
  await writeSave(training);
  const saved = await readSave(training.id);
  expect(saved.gameStartInfo.players[0].username).toBe("Training Player");
  expect(saved.snapshot).toEqual(training.snapshot);
  expect(saved.turns).toEqual(turns);
  expect(saved.education).toEqual(training.education);
  expect(saved.ui).toEqual(training.ui);
  expect(saved.paused).toBe(true);
  const joined = vi.fn();
  page.addEventListener("join-lobby", joined);
  await resumeSave(training.id);
  expect(joined).toHaveBeenCalledOnce();
  expect((joined.mock.calls[0][0] as CustomEvent).detail.savedGame).toEqual(
    saved,
  );
  const restored = await createGameRunnerFromSnapshot(
    saved.gameStartInfo,
    saved.snapshot,
    "Trainer1",
    TRAINING_LOADER,
    onUpdate,
  );
  const human = restored.game.playerByClientID("Trainer1")!;
  expect(human.hasSpawned()).toBe(true);
  expect(human.numTilesOwned()).toBe(1200);
  expect(restored.game.isShoreline(human.spawnTile()!)).toBe(true);
  expect(
    diffSnapshots(restored.snapshot(saveBuild), training.snapshot),
  ).toEqual([]);
  // The old localized core name remains invalid; no global schema loosening.
  const invalid = structuredClone(training);
  invalid.gameStartInfo.players[0].username = "훈련생";
  await expect(writeSave(invalid)).rejects.toThrow();
  expect((await readSave(training.id)).snapshot).toEqual(training.snapshot);
  expect(errors).toEqual([]);
}, 30_000);

it("compatible continue passes the complete save to the existing join flow", async () => {
  await writeSave(fixture);
  const joined = vi.fn();
  page.addEventListener("join-lobby", joined);
  await resumeSave("manual");
  expect(joined).toHaveBeenCalledOnce();
  const event = joined.mock.calls[0][0] as CustomEvent;
  expect(event.detail.source).toBe("singleplayer");
  expect(event.detail.savedGame.snapshot).toEqual(fixture.snapshot);
  expect(event.detail.savedGame.turns).toHaveLength(8);
  expect(event.detail.savedGame.paused).toBe(true);
  expect(event.detail.savedGame.ui).toEqual({ attackRatio: 1 });
});

it("loads older saves without UI state without inventing a saved ratio", async () => {
  const legacy = { ...fixture };
  delete legacy.ui;
  await writeSave(legacy);
  expect((await readSave("manual")).ui).toBeUndefined();
});

it.each([-0.01, 1.01, NaN, Infinity])(
  "rejects invalid UI attack ratio %s before replacing a valid save",
  async (attackRatio) => {
    await writeSave(fixture);
    await expect(
      writeSave({ ...fixture, ui: { attackRatio } }),
    ).rejects.toThrow();
    expect((await readSave("manual")).ui).toEqual({ attackRatio: 1 });
  },
);

it("wrong-build continue refuses without deleting the recoverable save", async () => {
  const foreignRoot = decodeSnapshotValue(fixture.snapshot) as Record<
    string,
    unknown
  >;
  foreignRoot.gitCommit = "another-build";
  await writeSave({
    ...fixture,
    build: "another-build",
    snapshot: encodeSnapshotValue(foreignRoot),
  });
  const joined = vi.fn();
  page.addEventListener("join-lobby", joined);
  await expect(resumeSave("manual")).rejects.toThrow("different build");
  expect(joined).not.toHaveBeenCalled();
  expect(await listSaves()).toHaveLength(1);
  expect((await readSave("manual")).build).toBe("another-build");
});

it.each(["format", "tick", "history", "order", "game", "config", "build"])(
  "rejects mismatched %s before replacing an existing save",
  async (kind) => {
    await writeSave(fixture);
    const invalid = structuredClone(fixture);
    if (kind === "format") Object.assign(invalid, { format: 2 });
    if (kind === "tick") invalid.tick++;
    if (kind === "history") invalid.turns.pop();
    if (kind === "order") invalid.turns[0].turnNumber = 5;
    if (kind === "game") invalid.gameStartInfo.gameID = "OTHER123";
    if (kind === "config") invalid.gameStartInfo.config.bots = 1;
    if (kind === "build") invalid.build = "another-build";
    await expect(writeSave(invalid)).rejects.toThrow();
    expect((await readSave("manual")).snapshot).toEqual(fixture.snapshot);
  },
);

it("abort/quota failure preserves an existing autosave atomically", async () => {
  await writeSave({ ...fixture, id: "autosave" });
  storage.abortNextWrite = true;
  await expect(
    writeSave({
      ...fixture,
      id: "autosave",
      name: "replacement",
      createdAt: 2000,
    }),
  ).rejects.toThrow("quota");
  const old = await readSave("autosave");
  expect(old.name).toBe(fixture.name);
  expect(old.createdAt).toBe(1000);
  expect(old.snapshot).toEqual(fixture.snapshot);
});

it("export/import round trip creates a separate save and preserves snapshot/history", async () => {
  await writeSave(fixture);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    exported = blob as Blob;
    return "blob:test-save";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await exportSave("manual");
  const file = new File([exported!], "saved-game.json", {
    type: "application/json",
  });
  const imported = await importSave(file);
  expect(imported.id).not.toBe("manual");
  expect(await listSaves()).toHaveLength(2);
  const reread = await readSave(imported.id);
  expect(reread.snapshot).toEqual(fixture.snapshot);
  expect(reread.turns).toEqual(fixture.turns);
  expect(reread.ui).toEqual({ attackRatio: 1 });
  expect((await readSave("manual")).name).toBe(fixture.name);
  await deleteSave(imported.id);
  expect(await listSaves()).toHaveLength(1);
});

it("corrupt persisted gzip is reported without erasing its entry", async () => {
  await writeSave(fixture);
  const stored = storage.records.get("manual") as { compressed: Uint8Array };
  stored.compressed = new Uint8Array([1, 2, 3]);
  await expect(readSave("manual")).rejects.toThrow();
  expect(await listSaves()).toHaveLength(1);
});

it("invalid imported format/header is rejected without overwriting any data", async () => {
  await writeSave(fixture);
  const root = decodeSnapshotValue(fixture.snapshot) as Record<string, unknown>;
  root.gameID = "OTHER123";
  const invalid = { ...fixture, snapshot: encodeSnapshotValue(root) };
  await expect(writeSave(invalid)).rejects.toThrow("disagree");
  await expect(
    importSave(new File([JSON.stringify({ format: 2 })], "wrong.json")),
  ).rejects.toThrow();
  expect((await readSave("manual")).snapshot).toEqual(fixture.snapshot);
});

it("restored paused-game full view includes existing territory without changing the snapshot", async () => {
  const runner = await createGameRunnerFromSnapshot(
    start,
    fixture.snapshot,
    CLIENT,
    new TestDataMapLoader("plains"),
    () => {},
  );
  const before = runner.snapshot(saveBuild);
  const update = runner.fullViewUpdate();
  expect(update.tick).toBe(fixture.tick);
  expect(update.packedTileUpdates).toHaveLength(
    runner.game.width() * runner.game.height() * 2,
  );
  expect(runner.game.playerByClientID(CLIENT)!.numTilesOwned()).toBeGreaterThan(
    0,
  );
  expect(diffSnapshots(runner.snapshot(saveBuild), before)).toEqual([]);
});

it("oversized import is rejected before attempting to read its contents", async () => {
  const file = new File([""], "oversized.json");
  Object.defineProperty(file, "size", { value: 65 * 1024 * 1024 });
  const read = vi.spyOn(file, "text");
  await expect(importSave(file)).rejects.toThrow("64 MiB");
  expect(read).not.toHaveBeenCalled();
});

it("bounded gzip decoding rejects excess output while allowing exactly the limit", async () => {
  const bytes = new Uint8Array(65536).fill(1);
  const compressed = await compressSnapshot(bytes);
  await expect(decompressSnapshot(compressed, 32768)).rejects.toThrow(
    "size limit",
  );
  expect(await decompressSnapshot(compressed, 65536)).toEqual(bytes);
});

it("an ended save's restored full view includes the winner without mutating state", async () => {
  const runner = await createGameRunnerFromSnapshot(
    start,
    fixture.snapshot,
    CLIENT,
    new TestDataMapLoader("plains"),
    () => {},
  );
  const winner = runner.game.playerByClientID(CLIENT)!;
  runner.game.setWinner(winner, runner.game.stats().stats());
  const ended = runner.snapshot(saveBuild);
  const restored = await createGameRunnerFromSnapshot(
    start,
    ended,
    CLIENT,
    new TestDataMapLoader("plains"),
    () => {},
  );
  const update = restored.fullViewUpdate();
  expect(update.updates[GameUpdateType.Win]).toHaveLength(1);
  expect(update.updates[GameUpdateType.Win][0].winner).toBeDefined();
  expect(restored.game.getWinner()).toBe(
    restored.game.playerByClientID(CLIENT),
  );
  expect(diffSnapshots(restored.snapshot(saveBuild), ended)).toEqual([]);
});
