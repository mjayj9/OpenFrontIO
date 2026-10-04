import { describe, expect, it } from "vitest";
import { ModernWorldModal } from "../../src/client/ModernWorldModal";
import { modernPlayerInfo, modernWorld } from "../../src/core/game/ModernWorld";
import { GameStartInfo, GameStartInfoSchema } from "../../src/core/Schemas";

describe("modern country start metadata", () => {
  it("starts every supported country with savable wire metadata and its real country identity", () => {
    const modal = new ModernWorldModal();
    let start: GameStartInfo | undefined;
    modal.addEventListener("join-lobby", (event) => {
      start = (event as CustomEvent).detail.gameStartInfo;
    });
    const ui = modal as unknown as { countryId: string; start: () => void };
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
});
