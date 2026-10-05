import { describe, expect, it } from "vitest";
import { ModernWorldModal } from "../../src/client/ModernWorldModal";
import {
  modernFactions,
  modernRegions,
} from "../../src/core/game/ModernRegions";
import { modernPlayerInfo, modernWorld } from "../../src/core/game/ModernWorld";
import { MODERN_RULES } from "../../src/core/modern/ModernRules";
import { GameStartInfo, GameStartInfoSchema } from "../../src/core/Schemas";

describe("modern country start metadata", () => {
  it("starts every supported country with savable wire metadata and its real country identity", () => {
    const modal = new ModernWorldModal();
    let start: GameStartInfo | undefined;
    modal.addEventListener("join-lobby", (event) => {
      start = (event as CustomEvent).detail.gameStartInfo;
    });
    const ui = modal as unknown as {
      countryId: string;
      rulesVersion: number;
      start: () => void;
    };
    ui.rulesVersion = 1;
    const failures: string[] = [];
    for (const country of modernWorld.countries) {
      ui.countryId = country.id;
      ui.start();
      expect(start).toBeDefined();
      if (!GameStartInfoSchema.safeParse(start).success)
        failures.push(country.id);
      // The wire username is separate from the public country name/flag.
      expect(modernPlayerInfo(country, start!).name).toBe(country.name);
      if (country.id === "KOR")
        expect(start!.players[0].username).toBe("South Korea");
      if (country.id === "CHN")
        expect(start!.players[0].username).toBe("Peoples Republic of China");
      if (country.id === "VCT")
        expect(start!.players[0].username).toBe("St Vincent and Grenadines");
    }
    expect(failures).toEqual([]);
  });
  it("shows the selected UI language's country name even when HTML lang differs", () => {
    const selector = document.createElement("lang-selector") as HTMLElement & {
      currentLang: string;
    };
    selector.currentLang = "ko";
    document.body.appendChild(selector);
    try {
      const ui = new ModernWorldModal() as unknown as {
        name: (country: (typeof modernWorld.countries)[number]) => string;
      };
      expect(ui.name(modernWorld.countries.find((c) => c.id === "KOR")!)).toBe(
        "대한민국",
      );
      selector.currentLang = "en";
      expect(ui.name(modernWorld.countries.find((c) => c.id === "KOR")!)).toBe(
        "South Korea",
      );
    } finally {
      selector.remove();
    }
  });
  it("starts every independent region with one controller and the common population rules", () => {
    const modal = new ModernWorldModal();
    let start: GameStartInfo | undefined;
    modal.addEventListener("join-lobby", (event) => {
      start = (event as CustomEvent).detail.gameStartInfo;
    });
    const ui = modal as unknown as {
      countryId: string;
      factionId: string;
      start: () => void;
    };
    for (const faction of modernFactions) {
      ui.countryId = faction.parentCountryId;
      ui.factionId = faction.id;
      ui.start();
      expect(GameStartInfoSchema.safeParse(start).success, faction.id).toBe(
        true,
      );
      expect(start!.players).toHaveLength(1);
      expect(start!.config.modernMode).toMatchObject({
        scenario: "modern-regions-v2",
        version: 2,
        dataHash: modernRegions.hash,
        countryId: faction.id,
        factionId: faction.id,
        balance: "balanced",
        initialPopulation: MODERN_RULES.initialPopulation,
        aiLevelWeights: { low: 1, medium: 1, high: 1 },
      });
      expect(start!.gameID.startsWith("MR")).toBe(true);
      expect(start!.config.enhancedAI?.fairResources).toBe(true);
    }
  });
  it("starts modern lessons through the real v2 initializer rather than Classic training", () => {
    const modal = new ModernWorldModal();
    let start: GameStartInfo | undefined;
    modal.addEventListener("join-lobby", (event) => {
      start = (event as CustomEvent).detail.gameStartInfo;
    });
    modal.startModernPractice("air");
    expect(start!.config.training).not.toBe(true);
    expect(start!.config.modernMode).toMatchObject({
      scenario: "modern-regions-v2",
      trainingLesson: "air",
      victory: "timed",
    });
    modal.startModernPractice("climate");
    expect(start!.config.modernMode).toMatchObject({
      countryId: "PAK",
      trainingLesson: "climate",
      initialPopulation: MODERN_RULES.initialPopulation,
    });
    modal.startModernPractice("ports");
    expect(start!.config.modernMode).toMatchObject({
      countryId: "PRT",
      trainingLesson: "ports",
      initialPopulation: MODERN_RULES.initialPopulation,
    });
  });
});
