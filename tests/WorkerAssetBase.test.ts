import { afterEach, expect, test, vi } from "vitest";
import { buildAssetUrl, getWorkerCdnBase } from "../src/core/AssetUrls";

afterEach(() => vi.unstubAllGlobals());
test.each([
  ["", "https://game.example/"],
  ["/", "https://game.example/"],
  ["/cdn", "https://game.example/cdn"],
  ["./cdn", "https://game.example/lobby/cdn"],
  ["https://cdn.example/", "https://cdn.example/"],
])("Blob worker receives an absolute asset base for %j", (base, expected) => {
  vi.stubGlobal("window", {
    location: { href: "https://game.example/lobby/index.html" },
    BOOTSTRAP_CONFIG: { cdnBase: base },
  });
  expect(getWorkerCdnBase()).toBe(expected);
  const asset = buildAssetUrl(
    "maps/world/map.bin",
    { "maps/world/map.bin": "/_assets/maps/world/map.hash.bin" },
    getWorkerCdnBase(),
  );
  expect(new URL(asset, "blob:https://game.example/worker-id").protocol).toBe(
    "https:",
  );
});
test("worker-side calls retain the initialized absolute base", () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("__CDN_BASE__", "https://game.example/");
  expect(getWorkerCdnBase()).toBe("https://game.example/");
});
