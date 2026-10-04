import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavePanel } from "../../src/client/hud/layers/SavePanel";
import { SaveManager } from "../../src/client/SaveManager";
import {
  deleteSave,
  listSaves,
  resumeSave,
} from "../../src/client/SingleplayerSaves";

vi.mock("../../src/client/SingleplayerSaves", () => ({
  listSaves: vi.fn(),
  deleteSave: vi.fn(),
  exportSave: vi.fn(),
  importSave: vi.fn(),
  resumeSave: vi.fn(),
}));

async function flush(element: SavePanel | SaveManager) {
  await element.updateComplete;
  await Promise.resolve();
  await element.updateComplete;
}

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const found = [...element.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

describe("Single-player save controls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(listSaves).mockResolvedValue([
      {
        id: "save-one",
        name: "Korea",
        createdAt: 1_800_000_000_000,
        build: "same-build",
        tick: 700,
      },
    ]);
    vi.mocked(deleteSave).mockResolvedValue();
    vi.mocked(resumeSave).mockResolvedValue();
  });

  afterEach(() => {
    document.body
      .querySelectorAll("save-manager")
      .forEach((manager) => (manager as SaveManager).close());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("saves the running game through the runner and reports failure without false success", async () => {
    const panel = new SavePanel();
    const save = vi.fn().mockRejectedValueOnce(new Error("storage quota"));
    panel.configure({ save });
    document.body.append(panel);
    await flush(panel);
    button(panel, "saves.menu ▾").click();
    await flush(panel);
    button(panel, "saves.save").click();
    await flush(panel);
    expect(save).toHaveBeenCalledWith(undefined, false);
    expect(panel.querySelector("[role=alert]")?.textContent).toContain(
      "storage quota",
    );
    expect(panel.textContent).not.toContain("saves.saved");
    save.mockResolvedValueOnce(undefined);
    button(panel, "saves.save").click();
    await flush(panel);
    expect(panel.querySelector("[role=status]")?.textContent).toContain(
      "saves.saved",
    );
  });

  it("only deletes after explicit confirmation and supports cancelling", async () => {
    const manager = new SaveManager();
    document.body.append(manager);
    await flush(manager);
    manager.open();
    await flush(manager);
    button(manager, "saves.delete").click();
    await flush(manager);
    expect(deleteSave).not.toHaveBeenCalled();
    button(manager, "common.cancel").click();
    await flush(manager);
    expect(deleteSave).not.toHaveBeenCalled();
    button(manager, "saves.delete").click();
    await flush(manager);
    button(manager, "saves.delete").click();
    await flush(manager);
    expect(deleteSave).toHaveBeenCalledOnce();
    expect(deleteSave).toHaveBeenCalledWith("save-one");
  });

  it("shows incompatible restore errors and keeps the save listed", async () => {
    vi.mocked(resumeSave).mockRejectedValueOnce(new Error("build mismatch"));
    const manager = new SaveManager();
    document.body.append(manager);
    await flush(manager);
    manager.open();
    await flush(manager);
    button(manager, "saves.continue").click();
    await flush(manager);
    expect(resumeSave).toHaveBeenCalledWith("save-one");
    expect(manager.querySelector("[role=alert]")?.textContent).toContain(
      "build mismatch",
    );
    expect(manager.textContent).toContain("Korea");
    expect(deleteSave).not.toHaveBeenCalled();
  });
});
