import fs from "fs";
import path from "path";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { GameMapLoader } from "../../src/core/game/GameMapLoader";
import { MapManifest } from "../../src/core/game/TerrainMapLoader";
import { GameStartInfo } from "../../src/core/Schemas";

/** Production-map training setup, including the schema-safe core player name. */
export const TRAINING_START: GameStartInfo = {
  gameID: "TrainRun",
  lobbyCreatedAt: 0,
  players: [
    { clientID: "Trainer1", username: "Training Player", clanTag: null },
  ],
  config: {
    training: true,
    gameMap: GameMapType.FourIslands,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Easy,
    bots: 1,
    nations: 1,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    startingGold: 10_000_000,
    donateGold: true,
    donateTroops: true,
    disabledUnits: [],
    customAllianceDuration: 5,
  },
};

const dir = path.resolve("resources/maps/fourislands");
export const TRAINING_LOADER: GameMapLoader = {
  getMapData: () => {
    const read = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: read("map.bin"),
      map4xBin: read("map4x.bin"),
      map16xBin: read("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: "",
      layerPng: async () => {
        throw new Error("Simulation does not load render layers");
      },
    };
  },
};
