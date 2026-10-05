import { render } from "lit";
import { describe, expect, it } from "vitest";
import { OButton } from "../../src/client/components/baseComponents/Button";
import { ModernLobbyPicker } from "../../src/client/components/ModernLobbyPicker";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import {
  modernFactions,
  modernRegions,
} from "../../src/core/game/ModernRegions";
import { ClientInfo, GameConfig } from "../../src/core/Schemas";

describe("modern invite lobby start control", () => {
  const mode: NonNullable<GameConfig["modernMode"]> = {
    scenario: "modern-regions-v2",
    version: 2,
    dataHash: modernRegions.hash,
    countryId: "KOR",
    balance: "balanced",
    victory: "territory",
    targetPercent: 60,
    protectionTicks: 300,
    capitalElimination: false,
    participantSlots: 8,
    fillEmptySlots: true,
  };
  const host: ClientInfo = {
    clientID: "host",
    username: "Host",
    clanTag: null,
    countryId: "KOR",
  };
  async function startButton(
    clients: ClientInfo[],
    modernMode?: GameConfig["modernMode"],
  ) {
    const modal = new HostLobbyModal();
    const ui = modal as unknown as {
      clients: ClientInfo[];
      modernMode: GameConfig["modernMode"];
      renderBody(): unknown;
    };
    ui.clients = clients;
    ui.modernMode = modernMode;
    const container = document.createElement("div");
    render(ui.renderBody() as never, container);
    const button = container.querySelector<OButton>("[data-test-lobby-start]")!;
    render(OButton.prototype.render.call(button), button);
    return button.querySelector<HTMLButtonElement>("button")!;
  }

  it("allows one reserved human and AI-filled invite slots", async () => {
    const button = await startButton([host], mode);
    expect(button.disabled).toBe(false);
    expect(button.textContent?.toLowerCase()).not.toContain("waiting");
  });
  it("keeps Classic and non-filling modern lobbies waiting for two humans", async () => {
    expect((await startButton([host])).disabled).toBe(true);
    expect(
      (await startButton([host], { ...mode, fillEmptySlots: false })).disabled,
    ).toBe(true);
  });
  it("still requires a reservation and at least one active human", async () => {
    expect(
      (await startButton([{ ...host, countryId: undefined }], mode)).disabled,
    ).toBe(true);
    expect(
      (await startButton([{ ...host, spectator: true }], mode)).disabled,
    ).toBe(true);
  });
  it("preserves the independent faction count when a legacy manifest finishes loading", async () => {
    const modal = new HostLobbyModal();
    const ui = modal as unknown as {
      modernMode: GameConfig["modernMode"];
      defaultNationCount: number;
      nations: number;
      mapLoader: {
        getMapData: () => { manifest: () => Promise<{ nations: unknown[] }> };
      };
      loadNationCount: () => Promise<void>;
    };
    let resolve!: (manifest: { nations: unknown[] }) => void;
    ui.mapLoader = {
      getMapData: () => ({
        manifest: () =>
          new Promise((done) => {
            resolve = done;
          }),
      }),
    };
    const pending = ui.loadNationCount();
    ui.modernMode = mode;
    resolve({ nations: Array.from({ length: 198 }) });
    await pending;
    expect(ui.nations).toBe(modernFactions.length);
    expect(ui.defaultNationCount).toBe(modernFactions.length);
  });
  it("initially shows the same parent country as the visible regional selection", () => {
    const picker = new ModernLobbyPicker();
    picker.mode = mode;
    const container = document.createElement("div");
    render(picker.render(), container);
    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    expect(selects[0].value).toBe("KOR");
    expect(selects[1].value).toBe("KOR");
  });
});
