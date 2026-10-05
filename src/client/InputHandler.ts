import { EventBus, GameEvent } from "../core/EventBus";
import { PlayerBuildableUnitType, UnitType } from "../core/game/Game";
import {
  INPUT_ACTIONS,
  inputActionRows,
  setActiveInputContext,
} from "../core/game/KeybindingRegistry";
import {
  KEYBINDS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { OModal } from "./components/baseComponents/Modal";
import type { HelpModal } from "./HelpModal";
import {
  MODERN_KEYBINDS_CHANGED,
  ModernBranchEvent,
  ModernCancelEvent,
  ModernCenterSelectionEvent,
  ModernPreviewEvent,
  ModernSelectVisibleEvent,
  ModernSelectionEvent,
  ModernStopEvent,
  ModernTargetEvent,
  modernKeybinds,
} from "./ModernInput";
import { Platform } from "./Platform";
import { UIState } from "./UIState";
import { ReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";
import { GameView, UnitView } from "./view";

export class MouseUpEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseOverEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}
export class TouchEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

/**
 * Event emitted when one or more warships are selected or deselected.
 * For single selection: unit is set, units is empty.
 * For multi selection: units contains all selected warships, unit is null.
 * For deselection: isSelected is false.
 */
export class UnitSelectionEvent implements GameEvent {
  constructor(
    public readonly unit: UnitView | null,
    public readonly isSelected: boolean,
    public readonly units: UnitView[] = [],
  ) {}
}

export class MouseDownEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseMoveEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ContextMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

/** Zoom sensitivity: scale is divided by `1 + delta / ZOOM_DELTA_DIVISOR`. */
export const ZOOM_DELTA_DIVISOR = 600;

export class ZoomEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly delta: number,
  ) {}
}

export class DragEvent implements GameEvent {
  constructor(
    public readonly deltaX: number,
    public readonly deltaY: number,
  ) {}
}

export class AlternateViewEvent implements GameEvent {
  constructor(public readonly alternateView: boolean) {}
}

export class CloseViewEvent implements GameEvent {}

export class RefreshGraphicsEvent implements GameEvent {}

export class ToggleRenderDebugGuiEvent implements GameEvent {}

export class TogglePerformanceOverlayEvent implements GameEvent {}

export class ToggleStructureEvent implements GameEvent {
  constructor(
    public readonly structureTypes: PlayerBuildableUnitType[] | null,
  ) {}
}

export class ConfirmGhostStructureEvent implements GameEvent {}

export class SwapRocketDirectionEvent implements GameEvent {
  constructor(public readonly rocketDirectionUp: boolean) {}
}

/** Emitted while the user is drawing a shift+drag selection rectangle */
export class WarshipSelectionBoxUpdateEvent implements GameEvent {
  constructor(
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number,
  ) {}
}

/** Emitted when the user releases the mouse after drawing a selection rectangle */
export class WarshipSelectionBoxCompleteEvent implements GameEvent {
  constructor(
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number,
  ) {}
}

/** Emitted when the selection box is cancelled (e.g. Escape or no drag) */
export class WarshipSelectionBoxCancelEvent implements GameEvent {}

/** Emitted when the player triggers select-all-warships hotkey */
export class SelectAllWarshipsEvent implements GameEvent {}

/** Emitted when a touch long-press is detected (shows crosshair indicator) */
export class TouchLongPressStartEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ShowBuildMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}
export class ShowEmojiMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class DoBoatAttackEvent implements GameEvent {}

export class DoGroundAttackEvent implements GameEvent {}

export class DoRetaliateAttackEvent implements GameEvent {}

export class DoRequestAllianceEvent implements GameEvent {}

export class DoBreakAllianceEvent implements GameEvent {}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class TogglePauseIntentEvent implements GameEvent {}

export class GameSpeedUpIntentEvent implements GameEvent {}

export class GameSpeedDownIntentEvent implements GameEvent {}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class AutoUpgradeEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ToggleCoordinateGridEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}

export class TickMetricsEvent implements GameEvent {
  constructor(
    public readonly tickExecutionDuration?: number,
    public readonly tickDelay?: number,
  ) {}
}

interface KeybindEntry {
  handler: (e: KeyboardEvent) => void;
  conditions: Array<(e: KeyboardEvent) => boolean>;
}

/**
 * WebKit's non-standard `GestureEvent`, fired for trackpad pinch in Safari.
 * Other browsers synthesize a ctrl+wheel event instead, handled in onScroll.
 * Not in `lib.dom.d.ts`, so declared here.
 *
 * @see https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html
 */
interface WebKitGestureEvent extends Event {
  /** Cumulative pinch scale since `gesturestart`, which reports 1.0. */
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

export class InputHandler {
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;

  private lastPointerDownX: number = 0;
  private lastPointerDownY: number = 0;

  private pointers: Map<number, PointerEvent> = new Map();

  private lastPinchDistance: number = 0;
  private lastModernPinchCenter: { x: number; y: number } | null = null;

  // Scale of the in-progress Safari pinch, or null when no gesture is active.
  private lastGestureScale: number | null = null;

  private pointerDown: boolean = false;

  private alternateView = false;

  // Warship selection box state
  private selectionBoxActive: boolean = false;
  // True while warships are selected via box (waiting for move target click)
  private multiSelectionActive: boolean = false;
  // True while any warship/boat is selected (single or multi) — right-click
  // cancels the selection instead of opening the context menu (#4692).
  private unitSelectionActive: boolean = false;

  // Touch long-press state
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressActive: boolean = false;
  private suppressNextTap: boolean = false;
  private readonly LONG_PRESS_MS = 800;

  private moveInterval: NodeJS.Timeout | null = null;
  /** Aborts every window/canvas listener added in
   * `initializePointerAndKeyboardEvents()`. */
  private listenerAbort: AbortController | null = null;
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};
  private keybindAndEvent: Array<[string, KeybindEntry]> = [];
  private pressKeybindAndEvent: Array<[string, KeybindEntry, string]> = [];
  private coordinateGridEnabled = false;
  private modernSelecting = false;
  private dispatchedPressKeys = new Set<string>();
  private cursorPreviewFrame = 0;
  private latestCursorPreview: ModernPreviewEvent | null = null;

  private replayContext(): boolean {
    return this.gameView.config?.().isReplay?.() === true;
  }

  private modalContext(): boolean {
    return (
      OModal.openCount > 0 ||
      (
        document.querySelector("settings-modal") as
          | (HTMLElement & { open?: boolean })
          | null
      )?.open === true
    );
  }

  private permitsAction(action: string): boolean {
    return (
      !this.replayContext() ||
      INPUT_ACTIONS.find((entry) => entry.id === action)?.contexts.includes(
        "replay",
      ) === true
    );
  }

  private modernContext(): boolean {
    return (
      this.gameView.config?.().gameConfig().modernMode?.scenario ===
      "modern-regions-v2"
    );
  }

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;
  private readonly DRAG_THRESHOLD_PX = 10;

  private readonly userSettings: UserSettings = new UserSettings();

  constructor(
    private gameView: GameView,
    public uiState: UIState,
    private canvas: HTMLElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    setActiveInputContext(
      this.modernContext() ? "modern" : "classic",
      this.replayContext() ? "replay" : "map",
    );
    this.buildKeybindTable();
    // Keybinds are editable mid-match now (the in-game settings modal has a
    // Keybinds tab), and this table is otherwise built once per game, so a
    // rebind would not take effect until the next one.
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.onKeybindsChanged,
    );
    globalThis.addEventListener(
      MODERN_KEYBINDS_CHANGED,
      this.onKeybindsChanged,
    );

    // Listen for warship selection to change cursor. Held in a field so
    // destroy() can release it: the EventBus is created once per page in
    // Main.ts and handed to every joinLobby(), so a subscription left behind
    // keeps this handler -- and the GameView, uiState and overlay it closes
    // over -- alive for the rest of the session, and runs against the next
    // game's events. off() first so a second initialize() cannot double it.
    this.eventBus.off(UnitSelectionEvent, this.onUnitSelection);
    this.eventBus.on(UnitSelectionEvent, this.onUnitSelection);
    this.eventBus.off(DragEvent, this.onCameraPractice);
    this.eventBus.on(DragEvent, this.onCameraPractice);
    this.eventBus.off(ZoomEvent, this.onZoomPractice);
    this.eventBus.on(ZoomEvent, this.onZoomPractice);

    this.initializePointerAndKeyboardEvents();
  }

  private onUnitSelection = (e: UnitSelectionEvent) => {
    this.unitSelectionActive =
      e.isSelected && (e.unit !== null || (e.units ?? []).length > 0);
    if (e.isSelected && (e.units ?? []).length > 0) {
      // Multi-selection active
      this.multiSelectionActive = true;
      this.canvas.style.cursor = "crosshair";
    } else if (e.isSelected) {
      // Single warship selected — cursor crosshair, but not multi
      this.multiSelectionActive = false;
      this.canvas.style.cursor = "crosshair";
    } else {
      // Deselected
      this.multiSelectionActive = false;
      if (!this.selectionBoxActive) {
        this.canvas.style.cursor = "";
      }
    }
  };

  private readonly onCameraPractice = (event: DragEvent) => {
    if (this.modernContext() && (event.deltaX || event.deltaY))
      this.uiState.modernCameraMoves =
        (this.uiState.modernCameraMoves ?? 0) + 1;
  };
  private readonly onZoomPractice = (event: ZoomEvent) => {
    if (this.modernContext() && event.delta)
      this.uiState.modernZoomChanges =
        (this.uiState.modernZoomChanges ?? 0) + 1;
  };

  private onKeybindsChanged = () => {
    this.activeKeys.clear();
    this.dispatchedPressKeys.clear();
    if (this.alternateView) {
      this.alternateView = false;
      this.eventBus.emit(new AlternateViewEvent(false));
    }
    this.buildKeybindTable();
  };

  /**
   * Drops every piece of in-flight pointer/drag/long-press state. Shared by
   * the blur handler, the re-initialize guard and destroy(): each has to leave
   * the handler with nothing latched, or a pointer that was physically down
   * stays recorded as down while `pointers` is empty, and the next ordinary
   * move is treated as a drag from a stale origin. Deliberately emits
   * nothing -- blur re-emits the events it owes around this call.
   */
  private resetPointerState() {
    this.pointerDown = false;
    this.pointers.clear();
    this.lastGestureScale = null;
    this.lastModernPinchCenter = null;
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressActive = false;
    this.suppressNextTap = false;
    this.selectionBoxActive = false;
    this.multiSelectionActive = false;
    this.modernSelecting = false;
    this.uiState.modernAdditiveSelection = false;
    this.uiState.modernQueueCommand = false;
  }

  /** Re-read the player's keybinds and rebuild the key dispatch table. */
  private buildKeybindTable() {
    this.keybinds = this.modernContext()
      ? modernKeybinds(this.userSettings, Platform.isMac)
      : this.userSettings.keybinds(Platform.isMac);
    this.keybindAndEvent = [];
    this.pressKeybindAndEvent = [];
    if (this.modernContext()) {
      for (const [action, branch] of [
        ["modernArmy", "army"],
        ["modernNavy", "navy"],
        ["modernAir", "air"],
        ["modernArmyAlternate", "army"],
        ["modernNavyAlternate", "navy"],
        ["modernAirAlternate", "air"],
      ] as const) {
        this.addPressKeybind(action, () => {
          this.eventBus.emit(new ModernBranchEvent(branch));
        });
      }
      this.addPressKeybind("modernStop", () =>
        this.eventBus.emit(new ModernStopEvent()),
      );
      this.addPressKeybind("modernSelectVisible", () =>
        this.eventBus.emit(new ModernSelectVisibleEvent()),
      );
    }
    this.addPressKeybind("buildMenu", () =>
      this.eventBus.emit(
        new ShowBuildMenuEvent(this.lastPointerX, this.lastPointerY),
      ),
    );
    this.addPressKeybind("help", () =>
      document.querySelector<HelpModal>("help-modal")?.openControls(),
    );

    this.addKeybindAndEvent(this.keybinds.boatAttack, () => {
      this.eventBus.emit(new DoBoatAttackEvent());
    });
    this.addKeybindAndEvent(this.keybinds.groundAttack, () => {
      this.eventBus.emit(new DoGroundAttackEvent());
    });
    this.addKeybindAndEvent(this.keybinds.retaliateAttack, () => {
      this.eventBus.emit(new DoRetaliateAttackEvent());
    });
    this.addPressKeybind("centerCamera", () =>
      this.eventBus.emit(
        this.modernContext()
          ? new ModernCenterSelectionEvent()
          : new CenterCameraEvent(),
      ),
    );
    this.addKeybindAndEvent(this.keybinds.selectAllWarships, () => {
      this.eventBus.emit(new SelectAllWarshipsEvent());
    });
    this.addKeybindAndEvent(this.keybinds.requestAlliance, () => {
      this.eventBus.emit(new DoRequestAllianceEvent());
    });
    this.addKeybindAndEvent(this.keybinds.breakAlliance, () => {
      this.eventBus.emit(new DoBreakAllianceEvent());
    });
    this.addKeybindAndEvent(
      this.keybinds.pauseGame,
      () => {
        this.eventBus.emit(new TogglePauseIntentEvent());
      },
      (e: KeyboardEvent) => !e.repeat,
    );
    this.addKeybindAndEvent(
      this.keybinds.gameSpeedUp,
      () => {
        this.eventBus.emit(new GameSpeedUpIntentEvent());
      },
      (e: KeyboardEvent) => !e.repeat,
    );
    this.addKeybindAndEvent(
      this.keybinds.gameSpeedDown,
      () => {
        this.eventBus.emit(new GameSpeedDownIntentEvent());
      },
      (e: KeyboardEvent) => !e.repeat,
    );
    this.addKeybindAndEvent(this.keybinds.attackRatioDown, () => {
      const increment = this.userSettings.attackRatioIncrement();
      this.eventBus.emit(new AttackRatioEvent(-increment));
    });
    this.addKeybindAndEvent(this.keybinds.attackRatioUp, () => {
      const increment = this.userSettings.attackRatioIncrement();
      this.eventBus.emit(new AttackRatioEvent(increment));
    });
    this.addKeybindAndEvent(this.keybinds.swapDirection, () => {
      const nextDirection = !this.uiState.rocketDirectionUp;
      this.eventBus.emit(new SwapRocketDirectionEvent(nextDirection));
    });
    this.addKeybindAndEvent(this.keybinds.performanceOverlay, () => {
      this.eventBus.emit(new TogglePerformanceOverlayEvent());
    });
    this.addKeybindAndEvent(this.keybinds.toggleView, () => {
      this.alternateView = false;
      this.eventBus.emit(new AlternateViewEvent(false));
    });
    const resetKey =
      inputActionRows(
        this.modernContext() ? "modern" : "classic",
        this.keybinds,
      ).find((row) => row.id === "resetGfx")?.binding ?? "";
    this.addKeybindAndEvent(resetKey, () => {
      this.eventBus.emit(new RefreshGraphicsEvent());
    });

    let buildKeybinds: string[] = [
      "buildCity",
      "buildFactory",
      "buildPort",
      "buildDefensePost",
      "buildMissileSilo",
      "buildSamLauncher",
      "buildAtomBomb",
      "buildHydrogenBomb",
      "buildWarship",
      "buildMIRV",
    ];
    buildKeybinds = buildKeybinds.map((i: string): string => {
      return this.keybinds[i];
    });
    buildKeybinds.push(
      ...[
        "Numpad0",
        "Numpad1",
        "Numpad2",
        "Numpad3",
        "Numpad4",
        "Numpad5",
        "Numpad6",
        "Numpad7",
        "Numpad8",
        "Numpad9",
        "Digit0",
        "Digit1",
        "Digit2",
        "Digit3",
        "Digit4",
        "Digit5",
        "Digit6",
        "Digit7",
        "Digit8",
        "Digit9",
      ],
    );
    buildKeybinds.push(
      ...buildKeybinds.map((t) => {
        return "Shift+" + t;
      }),
    );
    buildKeybinds = [...new Set(buildKeybinds)].filter((v): v is string =>
      Boolean(v),
    );
    for (const i of buildKeybinds) {
      this.addKeybindAndEvent(
        i,
        (e: KeyboardEvent) => {
          const matchedBuild = this.resolveBuildKeybind(e.code, e.shiftKey, e);

          if (matchedBuild !== null) {
            this.setGhostStructure(matchedBuild);
          }
        },
        () => this.canUseBuildKeybinds(),
        (e: KeyboardEvent) =>
          this.resolveBuildKeybind(e.code, e.shiftKey, e) !== null,
      );
    }
  }

  private initializePointerAndKeyboardEvents() {
    // A second initialize() would otherwise orphan the first listener set and
    // interval: nothing else holds the old controller, so they could never be
    // removed. Production only initializes once, but this keeps that from
    // being load-bearing.
    this.listenerAbort?.abort();
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    this.resetPointerState();
    this.listenerAbort = new AbortController();
    const { signal } = this.listenerAbort;
    window.addEventListener(
      "focusin",
      (event) => {
        if (this.isTextInputTarget(event.target) || this.modalContext()) {
          this.activeKeys.clear();
          this.dispatchedPressKeys.clear();
          if (this.alternateView) {
            this.alternateView = false;
            this.eventBus.emit(new AlternateViewEvent(false));
          }
        }
      },
      { signal },
    );
    window.addEventListener(
      "compositionstart",
      () => {
        this.activeKeys.clear();
        this.dispatchedPressKeys.clear();
      },
      { signal },
    );
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e), {
      signal,
    });
    window.addEventListener("pointerup", (e) => this.onPointerUp(e), {
      signal,
    });
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e), {
      signal,
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        this.onScroll(e);
        this.onShiftScroll(e);
        e.preventDefault();
      },
      { passive: false, signal },
    );
    // Safari trackpad pinch, which fires no ctrl+wheel event.
    this.canvas.addEventListener(
      "gesturestart",
      (e) => {
        e.preventDefault();
        this.lastGestureScale = (e as WebKitGestureEvent).scale;
      },
      { passive: false, signal },
    );
    this.canvas.addEventListener(
      "gesturechange",
      (e) => {
        e.preventDefault();
        this.onGestureChange(e as WebKitGestureEvent);
      },
      { passive: false, signal },
    );
    this.canvas.addEventListener(
      "gestureend",
      (e) => {
        e.preventDefault();
        this.lastGestureScale = null;
      },
      { passive: false, signal },
    );
    window.addEventListener("pointermove", this.onPointerMove.bind(this), {
      signal,
    });
    this.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e), {
      signal,
    });
    window.addEventListener(
      "mousemove",
      (e) => {
        if (e.movementX || e.movementY) {
          this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
        }
      },
      { signal },
    );
    // Clear all tracked keys when the window loses focus so keys that had
    // their keyup swallowed by the browser (e.g. cmd+zoom) don't stay stuck.
    // Also release the hold-to-view state and any active pointer/drag state
    // so the alternate view and drags aren't left latched when focus returns.
    window.addEventListener(
      "blur",
      () => {
        this.activeKeys.clear();
        this.dispatchedPressKeys.clear();
        this.latestCursorPreview = null;
        if (this.cursorPreviewFrame)
          cancelAnimationFrame(this.cursorPreviewFrame);
        this.cursorPreviewFrame = 0;
        if (this.alternateView) {
          this.alternateView = false;
          this.eventBus.emit(new AlternateViewEvent(false));
        }
        const hadSelection =
          this.selectionBoxActive || this.multiSelectionActive;
        this.resetPointerState();
        if (hadSelection) {
          this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
        }
        this.canvas.style.cursor = "";
      },
      { signal },
    );
    this.pointers.clear();

    this.moveInterval = setInterval(() => {
      if (this.modalContext() || this.isTextInputTarget(document.activeElement))
        return;
      let deltaX = 0;
      let deltaY = 0;

      // Keep the camera steady during a live warship selection. Explicit
      // Shift camera bindings still work when no selection is being dragged.
      if (this.selectionBoxActive || this.multiSelectionActive) {
        return;
      }

      if (
        this.heldKeybind(this.keybinds.moveUp) ||
        this.heldKeybind(this.keybinds.moveUpArrow)
      )
        deltaY += this.PAN_SPEED;
      if (
        this.heldKeybind(this.keybinds.moveDown) ||
        this.heldKeybind(this.keybinds.moveDownArrow)
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.heldKeybind(this.keybinds.moveLeft) ||
        this.heldKeybind(this.keybinds.moveLeftArrow)
      )
        deltaX += this.PAN_SPEED;
      if (
        this.heldKeybind(this.keybinds.moveRight) ||
        this.heldKeybind(this.keybinds.moveRightArrow)
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.heldKeybind(this.keybinds.zoomOut) ||
        this.heldKeybind(this.keybinds.zoomOutMinus) ||
        this.heldKeybind(this.keybinds.zoomOutNumpad)
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.heldKeybind(this.keybinds.zoomIn) ||
        this.heldKeybind(this.keybinds.zoomInEqual) ||
        this.heldKeybind(this.keybinds.zoomInNumpad)
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);

    window.addEventListener(
      "keydown",
      (e) => {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        // Modal widgets own their keys, including Escape. No map action leaks
        // through a focused button or a modal with no text field.
        if (this.modalContext()) return;
        const isTextInput = this.isTextInputTarget(e.target);
        if (isTextInput && !this.keybindMatchesEvent(e, this.keybinds.cancel)) {
          return;
        }

        for (const [key, entry, id] of this.pressKeybindAndEvent) {
          if (!this.keybindMatchesEvent(e, key) || !this.permitsAction(id))
            continue;
          e.preventDefault();
          if (!e.repeat && !this.dispatchedPressKeys.has(e.code)) {
            this.dispatchedPressKeys.add(e.code);
            entry.handler(e);
          }
          return;
        }

        if (this.keybindMatchesEvent(e, this.keybinds.toggleView)) {
          e.preventDefault();
          if (!this.alternateView) {
            this.alternateView = true;
            this.eventBus.emit(new AlternateViewEvent(true));
          }
        }

        if (
          this.keybindMatchesEvent(e, this.keybinds.coordinateGrid) &&
          !e.repeat
        ) {
          e.preventDefault();
          this.coordinateGridEnabled = !this.coordinateGridEnabled;
          this.eventBus.emit(
            new ToggleCoordinateGridEvent(this.coordinateGridEnabled),
          );
        }

        if (this.keybindMatchesEvent(e, this.keybinds.cancel) && !e.repeat) {
          e.preventDefault();
          let closedUI = false;

          if (this.uiState.ghostStructure !== null) {
            this.setGhostStructure(null);
            closedUI = true;
            if (this.modernContext()) return;
          }

          if (this.selectionBoxActive) {
            this.selectionBoxActive = false;
            this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
            closedUI = true;
          }

          this.eventBus.emit(new CloseViewEvent());
          if (this.modernContext()) {
            this.modernSelecting = false;
            this.uiState.modernTargeting = false;
            this.eventBus.emit(new ModernCancelEvent());
          }

          if (
            !closedUI &&
            (this.unitSelectionActive || this.multiSelectionActive)
          ) {
            this.eventBus.emit(new UnitSelectionEvent(null, false));
          }
        }

        if (
          (this.keybindMatchesEvent(e, this.keybinds.confirmPlacement) ||
            (this.keybinds.confirmPlacement === "Enter" &&
              e.code === "NumpadEnter")) &&
          !e.repeat &&
          this.uiState.ghostStructure !== null
        ) {
          e.preventDefault();
          this.eventBus.emit(new ConfirmGhostStructureEvent());
        }

        // Don't track zoom keys when a meta/ctrl modifier is held — that means
        // the browser is handling its own zoom (cmd+/cmd-) and the keyup will
        // never fire, which would leave the key stuck in activeKeys forever.
        // Also covers numpad zoom shortcuts (Ctrl+NumpadAdd/NumpadSubtract).
        const isBrowserZoomCombo =
          (e.metaKey || e.ctrlKey) &&
          (e.code === "Minus" ||
            e.code === "Equal" ||
            e.code === "NumpadAdd" ||
            e.code === "NumpadSubtract");

        const isConfiguredKeybind =
          Object.entries(this.keybinds).some(([id, key]) => {
            const phase = INPUT_ACTIONS.find((entry) => entry.id === id)?.phase;
            // A held physical modifier is allowed to share its own flag.
            // Other shortcuts must match the complete combination, otherwise
            // a default P/R/W would swallow browser Ctrl+P/R/W.
            if (phase === "modifier")
              return this.parseKeybind(key).code === e.code;
            return phase === "hold" && this.keybindMatchesEvent(e, key);
          }) ||
          this.keybindAndEvent.some(
            ([key, entry]) =>
              this.keybindMatchesEvent(e, key) &&
              entry.conditions.every((condition) => condition(e)),
          );

        if (isConfiguredKeybind && !isBrowserZoomCombo) {
          e.preventDefault();
        }

        if (
          !isBrowserZoomCombo &&
          [
            this.keybinds.moveUp,
            this.keybinds.moveDown,
            this.keybinds.moveLeft,
            this.keybinds.moveRight,
            this.keybinds.zoomOut,
            this.keybinds.zoomIn,
            this.keybinds.moveUpArrow,
            this.keybinds.moveLeftArrow,
            this.keybinds.moveDownArrow,
            this.keybinds.moveRightArrow,
            this.keybinds.zoomOutMinus,
            this.keybinds.zoomInEqual,
            this.keybinds.zoomInNumpad,
            this.keybinds.zoomOutNumpad,
            this.keybinds.attackRatioDown,
            this.keybinds.attackRatioUp,
            this.keybinds.centerCamera,
            "ControlLeft",
            "ControlRight",
            "AltLeft",
            "AltRight",
            "ShiftLeft",
            "ShiftRight",
            "MetaLeft",
            "MetaRight",
            this.keybinds.boxSelectWarships,
            this.keybinds.emojiMenuModifier,
            this.keybinds.buildMenuModifier,
            this.keybinds.altKey,
          ].some((value) => this.parseKeybind(value).code === e.code)
        ) {
          this.activeKeys.add(e.code);
        }

        // warship box selection mode.
        // If a ghost structure is active, discard it first.
        if (e.code === this.keybinds.boxSelectWarships) {
          if (!this.modernContext() && this.uiState.ghostStructure !== null) {
            this.setGhostStructure(null);
          }
          this.canvas.style.cursor = "crosshair";
        }
      },
      { signal },
    );
    window.addEventListener(
      "keyup",
      (e) => {
        if (this.dispatchedPressKeys.delete(e.code)) {
          this.activeKeys.delete(e.code);
          return;
        }
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) {
          this.activeKeys.delete(e.code);
          return;
        }
        const isTextInput = this.isTextInputTarget(e.target);
        if (this.modalContext() || isTextInput) {
          this.activeKeys.delete(e.code);
          return;
        }
        if (isTextInput && !this.activeKeys.has(e.code)) {
          return;
        }

        // When the meta (cmd) or ctrl key is released, any keys that were held
        // simultaneously will have had their keyup swallowed by the browser
        // (e.g. cmd+Plus for browser zoom). Clear zoom-related keys to
        // prevent them staying stuck in activeKeys.
        if (
          e.code === "MetaLeft" ||
          e.code === "MetaRight" ||
          e.code === "ControlLeft" ||
          e.code === "ControlRight"
        ) {
          this.activeKeys.delete("Minus");
          this.activeKeys.delete("Equal");
          this.activeKeys.delete("NumpadAdd");
          this.activeKeys.delete("NumpadSubtract");
          this.activeKeys.delete(this.keybinds.zoomIn);
          this.activeKeys.delete(this.keybinds.zoomOut);
        }

        outerLoop: for (const item of this.keybindAndEvent) {
          if (this.keybindMatchesEvent(e, item[0])) {
            for (const i of item[1].conditions) {
              if (!i(e)) {
                continue outerLoop;
              }
            }
            e.preventDefault();
            item[1].handler(e);
            break;
          }
        }
        this.activeKeys.delete(e.code);

        // Reset crosshair when Shift is released (unless selection box or multi-selection still active)
        if (
          e.code === this.keybinds.boxSelectWarships &&
          !this.selectionBoxActive &&
          !this.multiSelectionActive
        ) {
          this.canvas.style.cursor = "";
        }
      },
      { signal },
    );
  }

  private onPointerDown(event: PointerEvent) {
    if (this.modalContext()) return;
    if (this.cursorPreviewFrame) cancelAnimationFrame(this.cursorPreviewFrame);
    this.cursorPreviewFrame = 0;
    this.latestCursorPreview = null;
    if (event.button === 1) {
      event.preventDefault();
      this.eventBus.emit(new AutoUpgradeEvent(event.clientX, event.clientY));
      return;
    }

    if (event.button > 0) {
      return;
    }

    this.pointerDown = true;
    this.pointers.set(event.pointerId, event);

    if (this.pointers.size === 1) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.lastPointerDownX = event.clientX;
      this.lastPointerDownY = event.clientY;

      if (
        this.modernContext() &&
        !this.replayContext() &&
        this.uiState.ghostStructure === null &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        this.modernSelecting = true;
        // Selecting never emits the Classic attack MouseDown/MouseUp path.
        return;
      }

      this.eventBus.emit(new MouseDownEvent(event.clientX, event.clientY));

      // Start long-press timer for touch devices
      if (event.pointerType === "touch") {
        this.longPressActive = false;
        if (this.longPressTimer !== null) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          this.longPressActive = true;
          this.canvas.style.cursor = "crosshair";
          this.eventBus.emit(
            new TouchLongPressStartEvent(
              this.lastPointerDownX,
              this.lastPointerDownY,
            ),
          );
        }, this.LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      // Second finger down — cancel any pending long-press to avoid
      // triggering selection mode mid-pinch
      if (this.longPressTimer !== null) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (this.longPressActive) {
        this.longPressActive = false;
        this.canvas.style.cursor = "";
      }
      this.lastPinchDistance = this.getPinchDistance();
      this.lastModernPinchCenter = this.modernContext()
        ? this.getPinchCenter()
        : null;
    }
  }

  onPointerUp(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

    if (event.button > 0) {
      return;
    }
    // The release listener is global so map drags can end over the HUD. A HUD
    // click has no matching map pointerdown and must not reuse stale map state.
    if (!this.pointerDown || !this.pointers.has(event.pointerId)) {
      return;
    }
    const modernPinch = this.modernSelecting && this.pointers.size > 1;
    this.pointerDown = false;
    this.pointers.clear();

    if (this.modernSelecting) {
      this.modernSelecting = false;
      if (event.type === "pointercancel" || modernPinch) return;
      if (this.uiState.modernTargeting) {
        this.cancelCursorPreview();
        this.eventBus.emit(
          new ModernTargetEvent(
            event.clientX,
            event.clientY,
            event.shiftKey || Boolean(this.uiState.modernQueueCommand),
          ),
        );
      } else {
        const previousSelection =
          this.uiState.modernSelectedForceIds?.length ?? 0;
        const additive =
          event.shiftKey || Boolean(this.uiState.modernAdditiveSelection);
        this.eventBus.emit(
          new ModernSelectionEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
            additive,
            true,
          ),
        );
        const selected = this.uiState.modernSelectedForceIds?.length ?? 0;
        const distance =
          Math.abs(event.clientX - this.lastPointerDownX) +
          Math.abs(event.clientY - this.lastPointerDownY);
        if (selected && distance >= this.DRAG_THRESHOLD_PX)
          this.uiState.modernBoxSelections =
            (this.uiState.modernBoxSelections ?? 0) + 1;
        if (additive && selected > previousSelection)
          this.uiState.modernAdditionalSelections =
            (this.uiState.modernAdditionalSelections ?? 0) + 1;
      }
      event.preventDefault();
      return;
    }

    if (
      this.modernContext() &&
      event.altKey &&
      Math.abs(event.clientX - this.lastPointerDownX) +
        Math.abs(event.clientY - this.lastPointerDownY) >=
        this.DRAG_THRESHOLD_PX
    )
      return;

    // Clean up long-press state
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    const wasLongPress = this.longPressActive;
    this.longPressActive = false;
    if (wasLongPress) {
      this.canvas.style.cursor = "";
      // If long-press fired but no drag happened (selectionBoxActive is false),
      // suppress the tap so we don't emit a spurious TouchEvent
      if (!this.selectionBoxActive) {
        this.suppressNextTap = true;
      }
    }

    // Complete selection box if it was active
    if (this.selectionBoxActive) {
      this.selectionBoxActive = false;
      const dist =
        Math.abs(event.clientX - this.lastPointerDownX) +
        Math.abs(event.clientY - this.lastPointerDownY);
      if (dist >= this.DRAG_THRESHOLD_PX) {
        this.eventBus.emit(
          new WarshipSelectionBoxCompleteEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
          ),
        );
        return;
      } else {
        this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
      }
    }

    // macOS treats Ctrl+Left as secondary-click (context menu). Skip the
    // primary-click path so we don't also fire an attack (#4918), and do it
    // before modifier menus: if buildMenuModifier is rebound to ControlLeft,
    // we'd otherwise emit ShowBuildMenuEvent and still get ContextMenuEvent.
    // Mac-only: on Win/Linux event.ctrlKey is also true for Right Ctrl, which
    // is not the default build-menu bind and must still attack. Spawn-phase
    // Ctrl+click still needs MouseUpEvent — contextmenu is ignored then.
    if (Platform.isMac && event.ctrlKey && !this.gameView.inSpawnPhase()) {
      this.suppressNextTap = false;
      return;
    }

    // Modifier menus: on Win/Linux Ctrl is the default build-menu key, so a
    // ctrl+left must still reach ShowBuildMenuEvent (Mac already returned).
    if (this.modifierHeld(this.keybinds.buildMenuModifier)) {
      this.suppressNextTap = false;
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }
    if (this.modifierHeld(this.keybinds.emojiMenuModifier)) {
      this.suppressNextTap = false;
      this.eventBus.emit(new ShowEmojiMenuEvent(event.clientX, event.clientY));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < this.DRAG_THRESHOLD_PX) {
      if (event.pointerType === "touch") {
        if (this.suppressNextTap) {
          this.suppressNextTap = false;
          event.preventDefault();
          return;
        }
        this.eventBus.emit(new TouchEvent(event.x, event.y));
        event.preventDefault();
        return;
      }

      if (
        !this.userSettings.leftClickOpensMenu() ||
        event.shiftKey ||
        this.gameView.inSpawnPhase() || // No Radial Menu during spawn phase, only spawn point selection
        this.uiState.ghostStructure !== null // Block radial menu on left click if building
      ) {
        this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      } else {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
      }
    }
  }

  private onScroll(event: WheelEvent) {
    if (!event.shiftKey) {
      const realCtrl =
        this.activeKeys.has("ControlLeft") ||
        this.activeKeys.has("ControlRight");
      if (event.ctrlKey) {
        if (!realCtrl) {
          // Pinch-to-zoom gesture (trackpad): small deltas, amplify.
          // Ignore large deltas — those are browser zoom shortcuts (cmd+/cmd-)
          // which fire synthetic wheel events we don't want to handle.
          if (Math.abs(event.deltaY) <= 10) {
            this.eventBus.emit(
              new ZoomEvent(event.x, event.y, event.deltaY * 10),
            );
          }
        }
        // Always return when ctrlKey is set — whether it's a real ctrl scroll,
        // a pinch gesture, or a browser zoom event, none should reach the
        // regular scroll path below.
        return;
      }
      // Regular scroll wheel: ignore tiny residual momentum events that macOS
      // keeps sending after a gesture ends (especially after browser zoom changes
      // devicePixelRatio, which can cause these to accumulate into runaway zoom).
      if (Math.abs(event.deltaY) < 2) return;
      this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY));
    }
  }

  /**
   * `scale` is cumulative since gesturestart, so the per-event ratio is
   * `scale / lastGestureScale`. onZoom divides by `1 + delta / DIVISOR`, so
   * inverting that gives the delta reproducing the pinch ratio exactly.
   */
  private onGestureChange(event: WebKitGestureEvent) {
    if (this.lastGestureScale === null) return;

    const ratio = event.scale / this.lastGestureScale;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    // Advance the scale before the pointer guard: if a pointer lifts mid-gesture,
    // the next event must measure from here, not re-apply zoom from gesturestart.
    this.lastGestureScale = event.scale;

    // iOS sends these alongside pointer events, which onPointerMove already
    // zooms from. A trackpad pinch registers no pointers.
    if (this.pointers.size >= 2) return;

    const delta = ZOOM_DELTA_DIVISOR * (1 / ratio - 1);
    if (delta === 0) return;
    this.eventBus.emit(new ZoomEvent(event.clientX, event.clientY, delta));
  }

  private onShiftScroll(event: WheelEvent) {
    if (event.shiftKey) {
      const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const increment = this.userSettings.attackRatioIncrement();
      const ratio = scrollValue > 0 ? -increment : increment;
      this.eventBus.emit(new AttackRatioEvent(ratio));
    }
  }

  private onPointerMove(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

    if (event.button > 0) {
      return;
    }

    if (!this.pointerDown) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.eventBus.emit(new MouseOverEvent(event.clientX, event.clientY));
      if (
        this.modernContext() &&
        !this.replayContext() &&
        (event.target === this.canvas ||
          event.composedPath().includes(this.canvas))
      ) {
        this.scheduleModernPreview(event);
      }
      return;
    }

    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    this.pointers.set(event.pointerId, event);

    if (this.pointers.size === 1) {
      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;
      if (this.modernSelecting) {
        // A touch command drag previews the real target path. Selecting a
        // different unit here would lose the command's source before release.
        if (this.uiState.modernTargeting) {
          this.scheduleModernPreview(event);
          return;
        }
        this.eventBus.emit(
          new ModernSelectionEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
            event.shiftKey || Boolean(this.uiState.modernAdditiveSelection),
            false,
          ),
        );
        return;
      }

      // Cancel long-press if finger moved significantly before timer fires
      if (this.longPressTimer !== null) {
        const moveDist =
          Math.abs(event.clientX - this.lastPointerDownX) +
          Math.abs(event.clientY - this.lastPointerDownY);
        if (moveDist >= this.DRAG_THRESHOLD_PX) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
      }

      // If shift is held OR touch long-press is active OR selection box already
      // started, continue emitting selection box updates
      if (
        this.selectionBoxActive ||
        this.modifierHeld(this.keybinds.boxSelectWarships) ||
        this.longPressActive
      ) {
        this.selectionBoxActive = true;
        this.eventBus.emit(
          new WarshipSelectionBoxUpdateEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
          ),
        );
      } else {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
    } else if (this.pointers.size === 2) {
      const currentPinchDistance = this.getPinchDistance();
      const pinchDelta = currentPinchDistance - this.lastPinchDistance;
      const zoomCenter = this.getPinchCenter();
      if (this.modernContext()) {
        if (this.lastModernPinchCenter) {
          const dx = zoomCenter.x - this.lastModernPinchCenter.x;
          const dy = zoomCenter.y - this.lastModernPinchCenter.y;
          if (dx || dy) this.eventBus.emit(new DragEvent(dx, dy));
        }
        this.lastModernPinchCenter = zoomCenter;
      }

      if (Math.abs(pinchDelta) > 1) {
        this.eventBus.emit(
          new ZoomEvent(zoomCenter.x, zoomCenter.y, -pinchDelta * 2),
        );
        this.lastPinchDistance = currentPinchDistance;
      }
    }
  }

  private scheduleModernPreview(event: PointerEvent) {
    this.latestCursorPreview = new ModernPreviewEvent(
      event.clientX,
      event.clientY,
      event.shiftKey || Boolean(this.uiState.modernQueueCommand),
    );
    if (!this.cursorPreviewFrame)
      this.cursorPreviewFrame = requestAnimationFrame(() => {
        this.cursorPreviewFrame = 0;
        const preview = this.latestCursorPreview;
        this.latestCursorPreview = null;
        if (preview && !this.modalContext()) this.eventBus.emit(preview);
      });
  }

  private cancelCursorPreview() {
    if (this.cursorPreviewFrame) cancelAnimationFrame(this.cursorPreviewFrame);
    this.cursorPreviewFrame = 0;
    this.latestCursorPreview = null;
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (this.modalContext() || this.replayContext()) return;
    if (this.cursorPreviewFrame) cancelAnimationFrame(this.cursorPreviewFrame);
    this.cursorPreviewFrame = 0;
    this.latestCursorPreview = null;
    if (this.gameView.inSpawnPhase()) {
      return;
    }
    if (this.uiState.ghostStructure !== null) {
      this.setGhostStructure(null);
      return;
    }
    if (this.modernContext() && !event.ctrlKey && !event.metaKey) {
      this.eventBus.emit(
        new ModernTargetEvent(
          event.clientX,
          event.clientY,
          event.shiftKey || Boolean(this.uiState.modernQueueCommand),
        ),
      );
      return;
    }
    // If a warship/boat is selected, right-click cancels the selection rather
    // than opening the context menu (#4692).
    if (this.unitSelectionActive) {
      this.eventBus.emit(new UnitSelectionEvent(null, false));
      return;
    }
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private setGhostStructure(ghostStructure: PlayerBuildableUnitType | null) {
    if (
      this.uiState.ghostStructure === ghostStructure &&
      ghostStructure !== null
    ) {
      this.uiState.upgradeMultiplier =
        this.uiState.upgradeMultiplier === 1 ? 5 : 1;
    } else {
      this.uiState.upgradeMultiplier = 1;
      this.uiState.ghostStructure = ghostStructure;
    }
  }

  /**
   * Parses a keybind value that may include a "Shift+" prefix.
   * e.g. "Shift+KeyB" → { shift: true, code: "KeyB" }
   *      "KeyB"       → { shift: false, code: "KeyB" }
   */
  private parseKeybind(value: string) {
    const parts = value?.split("+") ?? [];
    const code = parts.pop() ?? "";
    return {
      code,
      shift: parts.includes("Shift"),
      ctrl: parts.includes("Ctrl"),
      alt: parts.includes("Alt"),
      meta: parts.includes("Meta"),
    };
  }

  /**
   * Returns true if the keyboard event matches the given keybind value,
   * including optional Shift+ prefix support.
   */
  private keybindMatchesEvent(
    e:
      | KeyboardEvent
      | {
          shiftKey: boolean;
          code: string;
          ctrlKey?: boolean;
          altKey?: boolean;
          metaKey?: boolean;
        },
    keybindValue: string,
  ): boolean {
    const parsed = this.parseKeybind(keybindValue);
    return (
      e.code === parsed.code &&
      (e.shiftKey === parsed.shift ||
        (keybindValue === "Equal" &&
          e.code === "Equal" &&
          e.shiftKey &&
          !Object.values(this.keybinds).includes("Shift+Equal"))) &&
      !!e.ctrlKey === parsed.ctrl &&
      !!e.altKey === parsed.alt &&
      !!e.metaKey === parsed.meta
    );
  }

  private heldKeybind(value: string): boolean {
    const key = this.parseKeybind(value);
    return (
      this.activeKeys.has(key.code) &&
      ((value === "Equal" &&
        !Object.values(this.keybinds).includes("Shift+Equal")) ||
        key.shift ===
          (this.activeKeys.has("ShiftLeft") ||
            this.activeKeys.has("ShiftRight"))) &&
      key.ctrl ===
        (this.activeKeys.has("ControlLeft") ||
          this.activeKeys.has("ControlRight")) &&
      key.alt ===
        (this.activeKeys.has("AltLeft") || this.activeKeys.has("AltRight")) &&
      key.meta ===
        (this.activeKeys.has("MetaLeft") || this.activeKeys.has("MetaRight"))
    );
  }

  /** Modifier actions can be a physical modifier or an explicit combination.
   * The modifier key itself must not count as an unexpected extra modifier. */
  private modifierHeld(value: string): boolean {
    if (!value) return false;
    const parsed = this.parseKeybind(value);
    const group = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(
      parsed.code,
    )?.[1];
    const down =
      group === "Shift"
        ? this.activeKeys.has(`${group}Left`) ||
          this.activeKeys.has(`${group}Right`)
        : this.activeKeys.has(parsed.code);
    return (
      down &&
      (group === "Shift" ||
        parsed.shift ===
          (this.activeKeys.has("ShiftLeft") ||
            this.activeKeys.has("ShiftRight"))) &&
      (group === "Control" ||
        parsed.ctrl ===
          (this.activeKeys.has("ControlLeft") ||
            this.activeKeys.has("ControlRight"))) &&
      (group === "Alt" ||
        parsed.alt ===
          (this.activeKeys.has("AltLeft") ||
            this.activeKeys.has("AltRight"))) &&
      (group === "Meta" ||
        parsed.meta ===
          (this.activeKeys.has("MetaLeft") || this.activeKeys.has("MetaRight")))
    );
  }

  /**
   * Extracts the digit character from KeyboardEvent.code.
   * Codes look like "Digit0".."Digit9" (6 chars, digit at index 5) and
   * "Numpad0".."Numpad9" (7 chars, digit at index 6). Returns null if not a digit key.
   */
  private digitFromKeyCode(code: string): string | null {
    if (
      code?.length === 6 &&
      code.startsWith("Digit") &&
      /^[0-9]$/.test(code[5])
    )
      return code[5];
    if (
      code?.length === 7 &&
      code.startsWith("Numpad") &&
      /^[0-9]$/.test(code[6])
    )
      return code[6];
    return null;
  }

  /** Digit/Numpad alias match: used only when no exact match was found. */
  private buildKeybindMatchesDigit(
    code: string,
    shiftKey: boolean,
    keybindValue: string,
  ): boolean {
    const parsed = this.parseKeybind(keybindValue);
    if (shiftKey !== parsed.shift) return false;
    const digit = this.digitFromKeyCode(code);
    const bindDigit = this.digitFromKeyCode(parsed.code);
    return digit !== null && bindDigit !== null && digit === bindDigit;
  }

  /**
   * Add a keybind that activates on one press
   * @param keybind The keybind that is being activated
   * @param event The code to be exectued when this keybind is pressed
   * @param conditions Optional conditions that can be added, they get the keyboard up event passed to them
   */
  private addKeybindAndEvent(
    keybind: string,
    event: (type: KeyboardEvent) => any,
    ...conditions: ((type: KeyboardEvent) => any)[]
  ) {
    const entry: KeybindEntry = {
      handler: event,
      conditions: [
        () => {
          const id = Object.entries(this.keybinds).find(
            ([, value]) => value === keybind,
          )?.[0];
          return !id || this.permitsAction(id);
        },
        ...conditions,
      ],
    };
    if (keybind) this.keybindAndEvent.push([keybind, entry]);
  }

  private addPressKeybind(
    action: string,
    handler: (event: KeyboardEvent) => void,
  ) {
    const key = this.keybinds[action];
    if (key)
      this.pressKeybindAndEvent.push([
        key,
        { handler, conditions: [] },
        action,
      ]);
  }

  /**
   * Resolves a keyup code to a build action: exact code match first, then digit/Numpad alias.
   * Returns the UnitType to set as ghost, or null if no build keybind matched.
   */
  private resolveBuildKeybind(
    code: string,
    shiftKey: boolean,
    modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
  ): PlayerBuildableUnitType | null {
    const buildKeybinds: ReadonlyArray<{
      key: string;
      type: PlayerBuildableUnitType;
    }> = [
      { key: "buildCity", type: UnitType.City },
      { key: "buildFactory", type: UnitType.Factory },
      { key: "buildPort", type: UnitType.Port },
      { key: "buildDefensePost", type: UnitType.DefensePost },
      { key: "buildMissileSilo", type: UnitType.MissileSilo },
      { key: "buildSamLauncher", type: UnitType.SAMLauncher },
      { key: "buildAtomBomb", type: UnitType.AtomBomb },
      { key: "buildHydrogenBomb", type: UnitType.HydrogenBomb },
      { key: "buildWarship", type: UnitType.Warship },
      { key: "buildMIRV", type: UnitType.MIRV },
    ];
    for (const { key, type } of buildKeybinds) {
      if (
        this.keybindMatchesEvent(
          { code, shiftKey, ...modifiers },
          this.keybinds[key],
        )
      )
        return type;
    }
    // A numpad key explicitly assigned to another action must not also act as a digit alias.
    if (
      Object.values(this.keybinds).some((value) =>
        this.keybindMatchesEvent({ code, shiftKey, ...modifiers }, value),
      )
    )
      return null;
    for (const { key, type } of buildKeybinds) {
      const parsed = this.parseKeybind(this.keybinds[key]);
      if (
        parsed.ctrl === !!modifiers.ctrlKey &&
        parsed.alt === !!modifiers.altKey &&
        parsed.meta === !!modifiers.metaKey &&
        this.buildKeybindMatchesDigit(code, shiftKey, this.keybinds[key])
      )
        return type;
    }
    return null;
  }

  private canUseBuildKeybinds(): boolean {
    const myPlayer = this.gameView.myPlayer?.();
    return (
      !this.replayContext() &&
      !this.gameView.inSpawnPhase() &&
      myPlayer?.isAlive() === true
    );
  }

  private getPinchDistance(): number {
    const pointerEvents = Array.from(this.pointers.values());
    const dx = pointerEvents[0].clientX - pointerEvents[1].clientX;
    const dy = pointerEvents[0].clientY - pointerEvents[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getPinchCenter(): { x: number; y: number } {
    const pointerEvents = Array.from(this.pointers.values());
    return {
      x: (pointerEvents[0].clientX + pointerEvents[1].clientX) / 2,
      y: (pointerEvents[0].clientY + pointerEvents[1].clientY) / 2,
    };
  }

  private isTextInputTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    // The keybind editor captures a raw key press on its own button and only
    // calls preventDefault(). Now that keybinds are editable in-game, binding
    // e.g. KeyG would otherwise also fire the ground attack behind the modal.
    if (
      typeof element.closest === "function" &&
      element.closest("setting-keybind") !== null
    ) {
      return true;
    }
    if (
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable
    ) {
      return true;
    }
    if (element.tagName === "INPUT") {
      return true;
    }
    return false;
  }

  destroy() {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.onKeybindsChanged,
    );
    globalThis.removeEventListener(
      MODERN_KEYBINDS_CHANGED,
      this.onKeybindsChanged,
    );
    this.listenerAbort?.abort();
    this.listenerAbort = null;
    this.eventBus.off(UnitSelectionEvent, this.onUnitSelection);
    this.eventBus.off(DragEvent, this.onCameraPractice);
    this.eventBus.off(ZoomEvent, this.onZoomPractice);
    // Includes the 800ms long-press timer a touch pointerdown arms: aborting
    // the listeners does not cancel it, so without this it can still fire
    // after teardown, emitting TouchLongPressStartEvent on the page-global
    // bus, into the next game, and setting the cursor on a canvas the
    // renderer has already removed.
    this.resetPointerState();
    this.activeKeys.clear();
    this.dispatchedPressKeys.clear();
    if (this.cursorPreviewFrame) cancelAnimationFrame(this.cursorPreviewFrame);
    this.cursorPreviewFrame = 0;
    this.latestCursorPreview = null;
    this.pressKeybindAndEvent = [];
    setActiveInputContext("classic", "map");
    this.keybindAndEvent = [];
    this.keybinds = {};
  }
}
