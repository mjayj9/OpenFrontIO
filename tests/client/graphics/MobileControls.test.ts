import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import type {
  MenuElement,
  MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { UnitDisplay } from "../../../src/client/hud/layers/UnitDisplay";
import type { UIState } from "../../../src/client/UIState";
import type { GameView } from "../../../src/client/view";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import {
  KEYBINDS_KEY,
  UserSettings,
} from "../../../src/core/game/UserSettings";
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (value: bigint | number) => String(value),
  getSvgAspectRatio: async () => 1,
}));

function touch(target: Element, type: string, x = 20, y = 20) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] },
    changedTouches: { value: [{ clientX: x, clientY: y }] },
  });
  target.dispatchEvent(event);
}

describe("mobile hotbar placement", () => {
  let bar: UnitDisplay;
  let state: UIState;
  beforeEach(async () => {
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    state = {
      ghostStructure: null,
      attackRatio: 0.2,
      upgradeMultiplier: 1,
      rocketDirectionUp: true,
    };
    bar = new UnitDisplay();
    bar.game = {
      config: () => ({ isUnitDisabled: () => false }),
      inSpawnPhase: () => false,
      myPlayer: () => ({
        isAlive: () => true,
        gold: () => 1000n,
        units: () => [],
      }),
    } as unknown as GameView;
    bar.eventBus = new EventBus();
    bar.uiState = state;
    bar["playerBuildables"] = [{ type: UnitType.City, cost: 200n }] as any;
    document.body.appendChild(bar);
    await bar.updateComplete;
  });
  afterEach(() => {
    bar.remove();
    vi.restoreAllMocks();
  });
  const city = () => {
    const el = bar.querySelector(
      '[role="button"][aria-label="unit_type.city"]',
    )!;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 44,
      bottom: 44,
    } as DOMRect);
    return el;
  };

  it("previews actual cost on press and selects placement only on release", async () => {
    const el = city();
    touch(el, "touchstart");
    await bar.updateComplete;
    expect(state.ghostStructure).toBeNull();
    expect(bar.querySelector(".unit-hotbar-tooltip")?.textContent).toContain(
      "200",
    );
    touch(el, "touchend");
    await bar.updateComplete;
    expect(state.ghostStructure).toBe(UnitType.City);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.ghostStructure).toBe(UnitType.City);
  });

  it("resets inherited utility translation in the actual inline mobile preview stylesheet", () => {
    const sheet = bar.querySelector("style")!.sheet!;
    const media = [...sheet.cssRules].find(
      (rule) => rule instanceof CSSMediaRule,
    ) as CSSMediaRule;
    const preview = [...media.cssRules].find(
      (rule) =>
        rule instanceof CSSStyleRule &&
        rule.selectorText === ".unit-hotbar-tooltip",
    ) as CSSStyleRule;
    // Inline Lit styles are shipped as JS, rather than CSS-optimized. The
    // actual stylesheet must neutralize Tailwind's separate -50% translate
    // so the explicit transform centers the preview exactly once.
    expect(preview.style.getPropertyValue("translate")).toMatch(/^0(?:px)?$/);
    expect(preview.style.getPropertyValue("transform")).toBe(
      "translateX(-50%)",
    );
  });

  it("cancels permanently when the finger slides outside before release", async () => {
    const el = city();
    touch(el, "touchstart");
    touch(el, "touchmove", 100, 100);
    touch(el, "touchend");
    await bar.updateComplete;
    expect(state.ghostStructure).toBeNull();
    expect(bar.querySelector(".unit-hotbar-tooltip")).toBeNull();
  });

  it("shows requirements when gold is insufficient and keeps placement inactive", async () => {
    bar["playerBuildables"] = [{ type: UnitType.City, cost: 2000n }] as any;
    const el = city();
    touch(el, "touchstart");
    await bar.updateComplete;
    expect(bar.querySelector(".unit-hotbar-tooltip")?.textContent).toContain(
      "build_menu.not_enough_money",
    );
    touch(el, "touchend");
    expect(state.ghostStructure).toBeNull();
  });

  it("focused build control activates and cancels placement with the keyboard", () => {
    const el = city();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(state.ghostStructure).toBe(UnitType.City);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(state.ghostStructure).toBeNull();
  });

  it("switches controls side and cancels an active placement", async () => {
    bar
      .querySelector<HTMLElement>('[aria-label="controls.swap_side"]')!
      .click();
    await bar.updateComplete;
    expect(bar.querySelector(".unit-hotbar")?.classList.contains("right")).toBe(
      true,
    );
    expect(new UserSettings().mobileControlsSide()).toBe("right");
    state.ghostStructure = UnitType.City;
    bar
      .querySelector<HTMLElement>('[aria-label="controls.cancel_placement"]')!
      .click();
    expect(state.ghostStructure).toBeNull();
  });
});

describe("radial touch actions", () => {
  let radial: RadialMenu;
  let action: ReturnType<typeof vi.fn>;
  let path: Element;
  beforeEach(() => {
    document.body.innerHTML = "";
    action = vi.fn();
    const leaf = {
      id: "test_build",
      name: "test",
      text: "Test",
      disabled: () => false,
      action,
      tooltipItems: [
        { text: "City", className: "title" },
        { text: "200 Gold", className: "cost" },
      ],
    } as MenuElement;
    radial = new RadialMenu(
      new EventBus(),
      {
        id: "root",
        name: "root",
        disabled: () => false,
        subMenu: () => [leaf],
      },
      { disabled: () => true, action: () => {} },
      { menuTransitionDuration: 0 },
    );
    radial.init();
    radial.setParams({
      game: { inSpawnPhase: () => false },
    } as unknown as MenuElementParams);
    radial.showRadialMenu(200, 200);
    path = document.querySelector('path[data-id="test_build"]')!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => path),
    });
  });
  afterEach(() => {
    radial.hideRadialMenu();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("previews on press, executes once on release, and ignores a synthetic click", () => {
    touch(path, "touchstart");
    expect(action).not.toHaveBeenCalled();
    expect(document.querySelector(".radial-tooltip")?.textContent).toContain(
      "200 Gold",
    );
    touch(path, "touchend");
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("center commands also wait for release and cancel when sliding away", () => {
    const center = document.querySelector(".center-button-hitbox")!;
    const centerAction = vi.fn();
    radial["centerButtonElement"] = {
      disabled: () => false,
      action: centerAction,
    };
    vi.mocked(document.elementFromPoint).mockReturnValue(center);
    touch(center, "touchstart");
    expect(centerAction).not.toHaveBeenCalled();
    touch(center, "touchend");
    center.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(centerAction).toHaveBeenCalledTimes(1);
    touch(center, "touchstart");
    vi.mocked(document.elementFromPoint).mockReturnValue(null);
    touch(center, "touchmove");
    touch(center, "touchend");
    expect(centerAction).toHaveBeenCalledTimes(1);
  });

  it("allows sliding away or system touch cancellation without a command", () => {
    touch(path, "touchstart");
    vi.mocked(document.elementFromPoint).mockReturnValue(null);
    touch(path, "touchmove", 1000, 1000);
    touch(path, "touchend");
    expect(action).not.toHaveBeenCalled();
    touch(path, "touchstart");
    touch(path, "touchcancel");
    touch(path, "touchend");
    expect(action).not.toHaveBeenCalled();
  });
});
