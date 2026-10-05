import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INPUT_ACTIONS,
  inputActionRows,
  inputDefaults,
} from "../../src/core/game/KeybindingRegistry";
import {
  INPUT_PROFILE_BACKUP_KEY,
  INPUT_PROFILE_KEY,
  KEYBINDS_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

describe("versioned military input migration", () => {
  beforeEach(() => {
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
  });

  it("backs up complete old profiles before resolving Q/W/E, B, F and X conflicts", () => {
    const settings = new UserSettings();
    settings.setKeybinds({
      zoomOut: { value: "KeyQ" },
      moveUp: "KeyW",
      zoomIn: ["KeyE"],
      boatAttack: "KeyB",
      selectAllWarships: "KeyF",
      moveDown: "KeyX",
      groundAttack: "Ctrl+Shift+KeyJ",
    });
    localStorage.setItem(
      "settings.modernKeybinds.v1",
      JSON.stringify({ modernArmy: "KeyZ" }),
    );
    const before = localStorage.getItem(KEYBINDS_KEY);
    const modern = settings.effectiveKeybinds("modern", false);
    expect([modern.modernArmy, modern.modernNavy, modern.modernAir]).toEqual([
      "KeyQ",
      "KeyW",
      "KeyE",
    ]);
    expect(modern.buildMenu).toBe("KeyB");
    expect(modern.boatAttack).toBe("Shift+KeyB");
    expect(modern.modernSelectVisible).toBe("KeyF");
    expect(modern.selectAllWarships).toBe("Shift+KeyF");
    expect(modern.modernStop).toBe("KeyX");
    expect(modern.moveDown).toBeUndefined();
    expect(modern.groundAttack).toBe("Ctrl+Shift+KeyJ");
    expect(modern.modernArmyAlternate).toBe("KeyZ");
    expect(settings.keybinds(false).moveDown).toBe("KeyX");
    expect(localStorage.getItem(KEYBINDS_KEY)).toBe(before);
    const backup = JSON.parse(localStorage.getItem(INPUT_PROFILE_BACKUP_KEY)!);
    expect(backup.classic).toBe(before);
    expect(backup.modern).toContain("KeyZ");
    expect(settings.inputMigrationNotices(false)).toContainEqual(
      expect.objectContaining({
        action: "moveDown",
        previous: "KeyX",
        replacement: "",
        reason: "conflict",
      }),
    );
  });

  it("does not reintroduce old settings after migration or overwrite a modern edit", () => {
    const settings = new UserSettings();
    settings.effectiveKeybinds("modern", false);
    expect(
      settings.setInputBinding("modern", "modernNavy", "Ctrl+KeyJ", false),
    ).toBe(true);
    localStorage.setItem("settings.modernKeybinds.v1", '{"modernNavy":"KeyW"}');
    settings.setKeybinds({ moveUp: "KeyW" });
    expect(settings.effectiveKeybinds("modern", false).modernNavy).toBe(
      "Ctrl+KeyJ",
    );
    expect(settings.effectiveKeybinds("modern", false).moveUp).toBeUndefined();
    expect(settings.resetInputBindings("modern", false)).toBe(true);
    expect(settings.effectiveKeybinds("modern", false).modernNavy).toBe("KeyW");
    expect(settings.keybinds(false).moveUp).toBe("KeyW");
  });

  it("rejects exact combination conflicts without stealing another action and preserves explicit unbinding", () => {
    const settings = new UserSettings();
    expect(
      settings.setInputBinding("modern", "modernArmy", "KeyW", false),
    ).toBe(false);
    expect(settings.effectiveKeybinds("modern", false).modernNavy).toBe("KeyW");
    expect(
      settings.setInputBinding(
        "modern",
        "modernArmy",
        "Shift+Ctrl+KeyJ",
        false,
      ),
    ).toBe(true);
    expect(settings.effectiveKeybinds("modern", false).modernArmy).toBe(
      "Ctrl+Shift+KeyJ",
    );
    expect(settings.setInputBinding("modern", "modernAir", "Null", false)).toBe(
      true,
    );
    expect(
      settings.effectiveKeybinds("modern", false).modernAir,
    ).toBeUndefined();
    expect(
      JSON.parse(localStorage.getItem(INPUT_PROFILE_KEY)!).modern.modernAir,
    ).toBe("");
  });

  it("uses working modern defaults even when the backup/profile write exceeds browser quota", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    const settings = new UserSettings();
    const modern = settings.effectiveKeybinds("modern", false);
    expect([modern.modernArmy, modern.modernNavy, modern.modernAir]).toEqual([
      "KeyQ",
      "KeyW",
      "KeyE",
    ]);
    expect(
      settings.setInputBinding("modern", "modernArmy", "KeyZ", false),
    ).toBe(false);
    spy.mockRestore();
  });

  it("rejects composed graphics reset collisions including modifier edits", () => {
    const settings = new UserSettings();
    expect(
      settings.setInputBinding("modern", "modernArmy", "Alt+KeyR", false),
    ).toBe(false);
    expect(settings.effectiveKeybinds("modern", false).modernArmy).toBe("KeyQ");
    expect(
      settings.setInputBinding("modern", "modernArmy", "Ctrl+KeyR", false),
    ).toBe(true);
    // Changing the shared graphics modifier would introduce Ctrl+R.
    expect(
      settings.setInputBinding("modern", "altKey", "ControlRight", false),
    ).toBe(false);
    expect(settings.setInputBinding("modern", "resetGfx", "KeyJ", false)).toBe(
      true,
    );
    expect(
      settings.setInputBinding("modern", "modernAir", "Alt+KeyJ", false),
    ).toBe(false);
    expect(settings.effectiveKeybinds("modern", false).modernAir).toBe("KeyE");
  });

  it("repairs imported effective conflicts once with a recoverable backup and notice", () => {
    const settings = new UserSettings();
    const profile = {
      version: 2,
      modern: { ...inputDefaults("modern", false), modernArmy: "Alt+KeyR" },
      notices: [],
    };
    localStorage.setItem(INPUT_PROFILE_KEY, JSON.stringify(profile));
    expect(
      settings.effectiveKeybinds("modern", false).modernArmy,
    ).toBeUndefined();
    expect(settings.inputMigrationNotices(false)).toEqual([
      expect.objectContaining({
        action: "modernArmy",
        previous: "Alt+KeyR",
        replacement: "",
        reason: "conflict",
      }),
    ]);
    expect(
      JSON.parse(
        localStorage.getItem(
          `${INPUT_PROFILE_KEY}.before-effective-conflicts`,
        )!,
      ),
    ).toEqual(profile);
    settings.effectiveKeybinds("modern", false);
    expect(settings.inputMigrationNotices(false)).toHaveLength(1);
  });

  it("has one registration for every keyboard default and reports mouse, unbound button and replay restrictions", () => {
    expect(new Set(INPUT_ACTIONS.map((entry) => entry.id)).size).toBe(
      INPUT_ACTIONS.length,
    );
    const rows = inputActionRows(
      "modern",
      new UserSettings().effectiveKeybinds("modern", false),
    );
    const replayRows = inputActionRows(
      "modern",
      new UserSettings().effectiveKeybinds("modern", false),
      "replay",
    );
    for (const id of Object.keys(inputDefaults("modern", false)))
      expect([...rows, ...replayRows].some((entry) => entry.id === id)).toBe(
        true,
      );
    expect(rows.find((entry) => entry.id === "pointerQueue")?.binding).toBe(
      "Shift+MouseRight",
    );
    expect(rows.find((entry) => entry.id === "saveGame")?.binding).toBe("");
    expect(
      inputActionRows("modern", {}, "replay").some(
        (entry) => entry.id === "modernArmy",
      ),
    ).toBe(false);
    expect(
      inputActionRows("classic", {}).some(
        (entry) => entry.id === "buildAirBase",
      ),
    ).toBe(false);
  });
});
