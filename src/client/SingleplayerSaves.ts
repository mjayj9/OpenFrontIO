import { z } from "zod";
import { modernAssignmentsFor } from "../core/modern/ModernAssignments";
import {
  GameConfigSchema,
  GameRecordSchema,
  GameStartInfo,
  GameStartInfoSchema,
  Turn,
  TurnSchema,
} from "../core/Schemas";
import {
  compressSnapshot,
  decompressSnapshot,
  readSnapshotHeader,
} from "../core/snapshot/GameSnapshot";
import { createPartialGameRecord } from "../core/Util";
import { ClientEnv } from "./ClientEnv";
import { JoinLobbyEvent } from "./Main";
import { openReplayViewer } from "./replay/ReplayEntry";

export const saveBuild =
  typeof __FORK_BUILD__ === "string" ? __FORK_BUILD__ : "test-build";
/** Storage identity: seeded local game IDs can repeat across new matches. */
export function automaticSaveId(build: string, runId: string): string {
  return `${runId}-${build.slice(0, 12)}-auto`;
}
export interface SaveSummary {
  id: string;
  name: string;
  createdAt: number;
  build: string;
  tick: number;
}
export interface SavedGame extends SaveSummary {
  format: 1;
  runId?: string;
  gameStartInfo: GameStartInfo;
  snapshot: Uint8Array;
  turns: Turn[];
  education?: unknown;
  ui?: { attackRatio: number };
  paused: boolean;
}
const envelopeSchema = z.object({
  format: z.literal(1),
  runId: z.string().uuid().optional(),
  id: z.string().max(100),
  name: z.string().max(100),
  createdAt: z.number().finite(),
  build: z.string().max(100),
  tick: z.number().int().nonnegative(),
  gameStartInfo: GameStartInfoSchema,
  turns: z.array(TurnSchema).max(200000),
  education: z.unknown().optional(),
  ui: z.object({ attackRatio: z.number().finite().min(0).max(1) }).optional(),
  paused: z.boolean(),
});
function validate(save: SavedGame): void {
  envelopeSchema.parse(save);
  const h = readSnapshotHeader(save.snapshot);
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  if (
    JSON.stringify(canonical(h.gameConfig)) !==
    JSON.stringify(canonical(GameConfigSchema.parse(save.gameStartInfo.config)))
  )
    throw new Error("Save setup differs from its snapshot");
  if (h.gitCommit !== save.build)
    throw new Error("Save build differs from its snapshot");
  if (
    h.tick !== save.tick ||
    save.turns.length !== save.tick ||
    h.gameID !== save.gameStartInfo.gameID
  )
    throw new Error("Save snapshot and command history disagree");
  if (save.gameStartInfo.config.gameType !== "Singleplayer")
    throw new Error("Only singleplayer saves can be resumed");
  for (let i = 0; i < save.turns.length; i++)
    if (save.turns[i].turnNumber !== i)
      throw new Error("Save has missing/reordered commands");
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("openfront-singleplayer-saves", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("games", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage unavailable"));
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  make: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("games", mode),
      req = make(tx.objectStore("games"));
    let result: T;
    req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? req.error ?? new Error("Browser save failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Browser save failed/quota exceeded"));
    };
  });
}
type Stored = Omit<SavedGame, "snapshot"> & { compressed: Uint8Array };
export async function writeSave(save: SavedGame): Promise<void> {
  validate(save);
  const { snapshot, ...metadata } = save;
  const compressed = await compressSnapshot(snapshot);
  // One atomic transaction: quota errors cannot erase the prior autosave.
  await operation("readwrite", (store) =>
    store.put({ ...metadata, compressed }),
  );
}
export async function listSaves(): Promise<SaveSummary[]> {
  const saves = await operation<Stored[]>("readonly", (store) =>
    store.getAll(),
  );
  return saves
    .map(({ id, name, createdAt, build, tick }) => ({
      id,
      name,
      createdAt,
      build,
      tick,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function readSave(id: string): Promise<SavedGame> {
  const stored = await operation<Stored | undefined>("readonly", (s) =>
    s.get(id),
  );
  if (!stored) throw new Error("Save not found");
  const { compressed, ...metadata } = stored;
  const save: SavedGame = {
    ...metadata,
    snapshot: await decompressSnapshot(compressed, 128 * 1024 * 1024),
  };
  validate(save);
  return save;
}
export async function deleteSave(id: string): Promise<void> {
  await operation("readwrite", (s) => s.delete(id));
}
export async function resumeSave(id: string): Promise<void> {
  const save = await readSave(id);
  if (save.build !== saveBuild)
    throw new Error(
      "Save belongs to a different build. Keep/export it and use its original build.",
    );
  document.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail: {
        gameID: save.gameStartInfo.gameID,
        gameStartInfo: save.gameStartInfo,
        source: "singleplayer",
        savedGame: save,
      } satisfies JoinLobbyEvent,
      bubbles: true,
      composed: true,
    }),
  );
}
export function reviewGame(start: GameStartInfo, turns: Turn[]): void {
  const record = GameRecordSchema.parse({
    ...createPartialGameRecord(
      start.gameID,
      start.config,
      start.players.map((player) => ({
        ...player,
        persistentID: null,
        stats: undefined,
      })),
      turns,
      start.lobbyCreatedAt,
      start.lobbyCreatedAt + turns.length * 100,
      undefined,
      start.lobbyCreatedAt,
      start.visibleAt,
      start.tribes,
      undefined,
      undefined,
      start.config.modernMode?.scenario === "modern-regions-v2"
        ? (start.modernAssignments ?? modernAssignmentsFor(start))
        : undefined,
    ),
    gitCommit: ClientEnv.gitCommit(),
  });
  openReplayViewer(start.gameID, record, true);
}
export async function reviewSave(id: string): Promise<void> {
  const save = await readSave(id);
  if (save.build !== saveBuild)
    throw new Error(
      "Replay belongs to a different build; retain its original build.",
    );
  reviewGame(save.gameStartInfo, save.turns);
}
export async function exportSave(id: string): Promise<void> {
  const save = await readSave(id);
  const compressed = await compressSnapshot(save.snapshot);
  let binary = "";
  for (let i = 0; i < compressed.length; i += 8192)
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  const { snapshot, ...metadata } = save;
  void snapshot;
  const blob = new Blob(
    [JSON.stringify({ ...metadata, compressed: btoa(binary) })],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `OpenFront-${save.gameStartInfo.gameID}-${save.tick}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importSave(file: File): Promise<SaveSummary> {
  if (file.size > 64 * 1024 * 1024) throw new Error("Save file exceeds 64 MiB");
  const raw = JSON.parse(await file.text());
  const metadata = envelopeSchema.parse(raw);
  if (
    typeof raw.compressed !== "string" ||
    raw.compressed.length > 64 * 1024 * 1024
  )
    throw new Error("Missing/oversized snapshot");
  const binary = atob(raw.compressed);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const snapshot = await decompressSnapshot(bytes, 128 * 1024 * 1024);
  if (snapshot.length > 128 * 1024 * 1024)
    throw new Error("Snapshot exceeds 128 MiB");
  const save: SavedGame = {
    ...metadata,
    id: `import-${Date.now()}-${crypto.randomUUID()}`,
    snapshot,
  };
  await writeSave(save);
  return save;
}
