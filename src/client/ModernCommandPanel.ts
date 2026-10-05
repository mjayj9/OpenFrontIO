import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../core/EventBus";
import { Cell, UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { modernRegions } from "../core/game/ModernRegions";
import { UserSettings } from "../core/game/UserSettings";
import {
  DEFAULT_MODERN_FORCE_RULES,
  ModernBranch,
  ModernCommandKind,
  ModernCommandPreview,
  ModernForceState,
} from "../core/modern/ModernForceTypes";
import { MODERN_RULES } from "../core/modern/ModernRules";
import { nuclearEffects } from "../core/modern/ModernState";
import { HelpModal } from "./HelpModal";
import {
  CenterCameraEvent,
  ContextMenuEvent,
  ShowBuildMenuEvent,
} from "./InputHandler";
import {
  MODERN_KEYBINDS_CHANGED,
  ModernBranchEvent,
  ModernBuildBaseEvent,
  ModernCancelEvent,
  ModernCenterSelectionEvent,
  ModernClearSelectionEvent,
  ModernPreviewEvent,
  ModernSelectVisibleEvent,
  ModernSelectionEvent,
  ModernStopEvent,
  ModernTargetEvent,
  modernKeybinds,
} from "./ModernInput";
import {
  MODERN_ICONS,
  curvedPath,
  drawCommandArrow,
  modernMapImage,
  type ArrowSegment,
} from "./ModernMapDisplay";
import { modernNuclearNotice } from "./ModernNuclearNotice";
import { queryPreviewBatches, stableChunks } from "./ModernSelectionCommands";
import { Platform } from "./Platform";
import { GoToPositionEvent, TransformHandler } from "./TransformHandler";
import { SendModernIntentEvent } from "./Transport";
import { UIState } from "./UIState";
import { formatKeyForDisplay, renderNumber, translateText } from "./Utils";
import { GameView } from "./view";

type PreviewQuery = (
  forceId: string,
  target: TileRef,
  command: ModernCommandKind,
  queue?: boolean,
) => Promise<ModernCommandPreview>;

@customElement("modern-command-panel")
export class ModernCommandPanel extends LitElement {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;
  public uiState!: UIState;
  public queryPreview!: PreviewQuery;
  @state() private branch: ModernBranch = "army";
  @state() private selectedIds: string[] = [];
  @state() private operation: ModernCommandKind | "auto" = "auto";
  @state() private status = "";
  @state() private expanded = false;
  @state() private minimized = false;
  @state() private preview: ModernCommandPreview | null = null;
  private previews = new Map<
    string,
    { preview: ModernCommandPreview; command: ModernCommandKind }
  >();
  @state() private target: TileRef | null = null;
  @state() private portId = "";
  @state() private climate = "temperate";
  @state() private climateOverlay = false;
  @state() private inspectTarget = false;
  @state() private selectedBaseId = "";
  @state() private productionManpowerSource:
    | "auto"
    | "army_reserve"
    | "available" = "auto";
  private productionPlacement: "armybase" | "navybase" | "airbase" | null =
    null;
  private pendingProductionTile: TileRef | null = null;
  private climateCanvas: HTMLCanvasElement | null = null;
  private pendingCommand: {
    command: ModernCommandKind;
    queue: boolean;
  } | null = null;
  private revision = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private nativeCosts = new Map<UnitType, number>();
  private nativeCostsTick = -Infinity;
  private nativeCostsRequest: number | null = null;
  private nativeCostsGeneration = 0;
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private selectionBox: ModernSelectionEvent | null = null;
  private stopped = true;
  private pendingStops = new Set<string>();
  private userSettings = new UserSettings();
  private pendingHover: ModernPreviewEvent | null = null;
  private hoverInFlight = false;
  private committing = false;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private cursor = { x: 0, y: 0 };
  private lastPreviewEvidenceTarget: TileRef | null = null;
  private arrowCache = new Map<
    string,
    { path: TileRef[]; segments: ArrowSegment[] }
  >();
  private previewCache = new Map<string, ModernCommandPreview>();

  createRenderRoot() {
    return this;
  }
  private readonly onBranch = (event: ModernBranchEvent) => {
    this.branch = event.branch;
    this.uiState.modernAdditiveSelection = false;
    this.uiState.modernQueueCommand = false;
    this.uiState.modernBranchesUsed = [
      ...new Set([...(this.uiState.modernBranchesUsed ?? []), event.branch]),
    ];
    this.selectedIds = [];
    this.operation = "auto";
    this.clearPreview();
    this.status = this.ownedForces().length
      ? translateText("modern_v2.select_units")
      : translateText("repair.no_branch_units");
  };
  private readonly onClear = () => {
    this.selectedIds = [];
    this.uiState.modernAdditiveSelection = false;
    this.uiState.modernQueueCommand = false;
    this.selectionBox = null;
    this.uiState.modernTargeting = false;
    this.clearPreview();
  };
  private readonly onKeys = () => this.requestUpdate();
  private readonly onStop = () => this.control("stop");
  private readonly onBuildBase = (event: ModernBuildBaseEvent) =>
    this.produce(event.kind);
  private readonly onCancel = () => {
    if (
      this.preview ||
      this.productionPlacement ||
      this.uiState.modernTargeting
    ) {
      this.uiState.modernTargeting = false;
      this.clearPreview();
    } else this.onClear();
  };
  private readonly onVisible = () => {
    this.selectedIds = this.ownedForces()
      .filter((force) => {
        const point = this.transform.worldToScreenCoordinates(
          new Cell(
            this.game.x(this.forceTile(force)) + 0.5,
            this.game.y(this.forceTile(force)) + 0.5,
          ),
        );
        return (
          point.x >= 0 &&
          point.y >= 0 &&
          point.x <= innerWidth &&
          point.y <= innerHeight
        );
      })
      .map((force) => force.id);
    this.uiState.modernSelectedForceIds = [...this.selectedIds];
    this.clearPreview();
  };
  private readonly onCenter = () => {
    const forces = this.ownedForces().filter((force) =>
      this.selectedIds.includes(force.id),
    );
    if (!forces.length) this.eventBus.emit(new CenterCameraEvent());
    else
      this.eventBus.emit(
        new GoToPositionEvent(
          forces.reduce(
            (sum, force) => sum + this.game.x(this.forceTile(force)),
            0,
          ) / forces.length,
          forces.reduce(
            (sum, force) => sum + this.game.y(this.forceTile(force)),
            0,
          ) / forces.length,
        ),
      );
  };
  private readonly onPreview = (event: ModernPreviewEvent) => {
    this.cursor = { x: event.x, y: event.y };
    if (
      !this.selectedIds.length ||
      this.productionPlacement ||
      this.inspectTarget
    )
      return;
    this.pendingHover = event;
    // Invalidate a previous response immediately, before waiting for it. Only
    // one cursor query batch can be in flight, regardless of pointer frequency.
    if (this.committing) return;
    this.revision++;
    if (!this.hoverInFlight && this.hoverTimer === null)
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        void this.flushHover();
      }, 60);
  };
  private async flushHover(): Promise<void> {
    const event = this.pendingHover;
    this.pendingHover = null;
    if (!event || this.stopped) return;
    const cell = this.transform.screenToWorldCoordinates(event.x, event.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const target = this.game.ref(cell.x, cell.y);
    if (target === this.target && this.pendingCommand?.queue === event.queue)
      return;
    this.hoverInFlight = true;
    await this.prepare(target, event.queue, true);
    this.hoverInFlight = false;
    if (this.pendingHover && !this.stopped) void this.flushHover();
  }
  private updatePlacement(): void {
    // The panel is a normal child of the existing bottom resource HUD. No
    // independent floating panel covers the battlefield or leaderboards.
    this.style.width = "100%";
  }
  private readonly onSelect = (event: ModernSelectionEvent) => {
    this.selectionBox = event.complete ? null : event;
    if (!event.complete) return;
    const tiny =
      Math.abs(event.endX - event.startX) +
        Math.abs(event.endY - event.startY) <
      10;
    const minX = Math.min(event.startX, event.endX) - (tiny ? 16 : 0);
    const maxX = Math.max(event.startX, event.endX) + (tiny ? 16 : 0);
    const minY = Math.min(event.startY, event.endY) - (tiny ? 16 : 0);
    const maxY = Math.max(event.startY, event.endY) + (tiny ? 16 : 0);
    const matches = this.ownedForces().filter((force) => {
      const point = this.transform.worldToScreenCoordinates(
        new Cell(
          this.game.x(this.forceTile(force)) + 0.5,
          this.game.y(this.forceTile(force)) + 0.5,
        ),
      );
      return (
        point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
      );
    });
    const nearest = tiny
      ? matches
          .filter(
            (force) => !event.additive || !this.selectedIds.includes(force.id),
          )
          .sort((a, b) => {
            const distance = (force: ModernForceState) => {
              const point = this.transform.worldToScreenCoordinates(
                new Cell(
                  this.game.x(this.forceTile(force)) + 0.5,
                  this.game.y(this.forceTile(force)) + 0.5,
                ),
              );
              return (point.x - event.endX) ** 2 + (point.y - event.endY) ** 2;
            };
            return distance(a) - distance(b) || a.id.localeCompare(b.id);
          })
          .slice(0, 1)
      : matches;
    if (tiny && !nearest.length) {
      const base = (this.systems()?.bases ?? [])
        .filter(
          (entry) =>
            entry.playerId === this.game.myPlayer()?.id() &&
            (entry.branch ?? "air") === this.branch,
        )
        .find((entry) => {
          const point = this.transform.worldToScreenCoordinates(
            new Cell(
              this.game.x(entry.tile) + 0.5,
              this.game.y(entry.tile) + 0.5,
            ),
          );
          return (
            Math.abs(point.x - event.endX) <= 18 &&
            Math.abs(point.y - event.endY) <= 18
          );
        });
      if (base) {
        this.selectedBaseId = base.id;
        this.expanded = true;
      }
    }
    this.selectedIds = [
      ...new Set([
        ...(event.additive ? this.selectedIds : []),
        ...nearest.map((force) => force.id),
      ]),
    ];
    this.uiState.modernSelectedForceIds = [...this.selectedIds];
    this.clearPreview();
    this.status = this.selectedIds.length
      ? ""
      : translateText("modern_v2.no_units");
  };
  private readonly onTarget = (event: ModernTargetEvent) => {
    this.pendingHover = null;
    this.cursor = { x: event.x, y: event.y };
    if (this.inspectTarget) {
      this.inspectTarget = false;
      this.uiState.modernTargeting = false;
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
      return;
    }
    const cell = this.transform.screenToWorldCoordinates(event.x, event.y);
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= this.game.width() ||
      cell.y >= this.game.height()
    ) {
      this.status = translateText("modern_v2.reason.out_of_map");
      return;
    }
    if (this.productionPlacement) {
      const tile = this.game.ref(cell.x, cell.y);
      if (this.productionPlacement === "navybase") {
        void this.prepareNavalBase(tile);
        return;
      }
      const me = this.game.myPlayer();
      const bases = this.systems()?.bases ?? [];
      const branch = this.productionPlacement === "armybase" ? "army" : "air";
      const valid = Boolean(
        me &&
        this.game.isLand(tile) &&
        !this.game.isImpassable(tile) &&
        this.game.ownerID(tile) === me.smallID() &&
        me.gold() >= BigInt(this.productionCost(this.productionPlacement)) &&
        !bases.some(
          (base) => base.tile === tile && (base.branch ?? "air") === branch,
        ) &&
        bases.filter(
          (base) =>
            base.playerId === me.id() && (base.branch ?? "air") === branch,
        ).length < DEFAULT_MODERN_FORCE_RULES.maxBasesPerFaction,
      );
      this.pendingProductionTile = tile;
      this.preview = {
        valid,
        reason: valid
          ? null
          : me &&
              me.gold() < BigInt(this.productionCost(this.productionPlacement))
            ? "insufficient_gold"
            : "base_requires_owned_land",
        path: [tile],
        etaTicks: 0,
        rangeTiles: 0,
        risk: "uncertain",
        climateEfficiencyPermille: 1000,
      };
      this.status = valid
        ? translateText("repair.production_detail", {
            gold: this.productionCost(this.productionPlacement),
            seconds: this.productionTicks(this.productionPlacement) / 10,
            personnel: 0,
          })
        : this.reason(this.preview.reason);
      return;
    }
    // A right click confirms this exact cursor destination. A stale hover
    // response can neither change it nor issue an unintended second command.
    const target = this.game.ref(cell.x, cell.y);
    const targetMode = Boolean(this.uiState.modernTargeting);
    this.committing = true;
    void this.prepare(target, event.queue, targetMode).then((valid) => {
      if (valid && this.target === target && !targetMode) this.confirm();
      this.committing = false;
      if (this.pendingHover && !this.stopped && !this.hoverInFlight)
        void this.flushHover();
    });
  };

  public start(): void {
    this.stop();
    this.stopped = false;
    this.eventBus.on(ModernBranchEvent, this.onBranch);
    this.eventBus.on(ModernClearSelectionEvent, this.onClear);
    this.eventBus.on(ModernSelectionEvent, this.onSelect);
    this.eventBus.on(ModernTargetEvent, this.onTarget);
    this.eventBus.on(ModernPreviewEvent, this.onPreview);
    this.eventBus.on(ModernStopEvent, this.onStop);
    this.eventBus.on(ModernSelectVisibleEvent, this.onVisible);
    this.eventBus.on(ModernCancelEvent, this.onCancel);
    this.eventBus.on(ModernCenterSelectionEvent, this.onCenter);
    this.eventBus.on(ModernBuildBaseEvent, this.onBuildBase);
    globalThis.addEventListener(MODERN_KEYBINDS_CHANGED, this.onKeys);
    this.interval = setInterval(() => {
      this.selectedIds = this.selectedIds.filter((id) =>
        this.ownedForces().some((force) => force.id === id),
      );
      this.uiState.modernSelectedForceIds = [...this.selectedIds];
      for (const force of this.systems()?.forces ?? []) {
        if (
          this.pendingStops.has(force.id) &&
          force.phase === "idle" &&
          force.command === null &&
          !force.queue.length
        ) {
          this.pendingStops.delete(force.id);
          this.uiState.modernCompletedStops =
            (this.uiState.modernCompletedStops ?? 0) + 1;
        }
      }
      this.refreshNativeCosts();
      this.updatePlacement();
      this.requestUpdate();
    }, 250);
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:12";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);
    this.frame = requestAnimationFrame(this.draw);
  }
  public stop(): void {
    this.stopped = true;
    this.revision++;
    if (this.eventBus) {
      this.eventBus.off(ModernBranchEvent, this.onBranch);
      this.eventBus.off(ModernClearSelectionEvent, this.onClear);
      this.eventBus.off(ModernSelectionEvent, this.onSelect);
      this.eventBus.off(ModernTargetEvent, this.onTarget);
      this.eventBus.off(ModernPreviewEvent, this.onPreview);
      this.eventBus.off(ModernStopEvent, this.onStop);
      this.eventBus.off(ModernSelectVisibleEvent, this.onVisible);
      this.eventBus.off(ModernCancelEvent, this.onCancel);
      this.eventBus.off(ModernCenterSelectionEvent, this.onCenter);
      this.eventBus.off(ModernBuildBaseEvent, this.onBuildBase);
    }
    globalThis.removeEventListener(MODERN_KEYBINDS_CHANGED, this.onKeys);
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.pendingHover = null;
    this.nativeCostsGeneration++;
    this.nativeCostsRequest = null;
    this.nativeCostsTick = -Infinity;
    this.nativeCosts.clear();
    this.clearPreview();
    this.selectedIds = [];
    this.selectedBaseId = "";
    this.pendingStops.clear();
    this.committing = false;
    this.hoverInFlight = false;
    this.status = "";
    if (this.uiState) {
      this.uiState.modernTargeting = false;
      this.uiState.modernSelectedForceIds = [];
      this.uiState.modernAdditiveSelection = false;
      this.uiState.modernQueueCommand = false;
    }
    this.arrowCache.clear();
    this.previewCache.clear();
    cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
  }
  disconnectedCallback(): void {
    this.stop();
    super.disconnectedCallback();
  }
  private previewSummary(): string {
    const preview = this.preview;
    if (!preview) return "";
    if (!preview.valid) return this.reason(preview.reason);
    if (this.productionPlacement)
      return translateText("repair.production_detail", {
        gold: this.productionCost(this.productionPlacement),
        seconds: this.productionTicks(this.productionPlacement) / 10,
        personnel: 0,
      });
    const summary = translateText("modern_v2.preview", {
      seconds: Math.ceil(preview.etaTicks / 10),
      range: preview.rangeTiles,
      risk: translateText(`modern_v2.risk.${preview.risk}`),
      efficiency: Math.round(preview.climateEfficiencyPermille / 10),
    });
    const combat = preview.armyCombat;
    const details = combat
      ? translateText("modern_v2.ground_preview", {
          attacker: renderNumber(
            combat.attackerLossRaw / MODERN_RULES.rawTroopsPerPerson,
          ),
          defender: renderNumber(
            combat.defenderLossRaw / MODERN_RULES.rawTroopsPerPerson,
          ),
          defenderClimate: Math.round(combat.defenderClimatePermille / 10),
          ratio: Math.round(combat.climateRatioPermille / 10),
        })
      : "";
    return [
      summary,
      details,
      preview.usesTransport ? translateText("modern_v2.transport_preview") : "",
      this.pendingCommand?.queue
        ? translateText("modern_v2.queue_preview")
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  private systems() {
    return this.game.modernSystems();
  }
  private selectFromRoster(id: string, shift = false): void {
    if (!this.ownedForces().some((force) => force.id === id)) return;
    const previousCount = this.selectedIds.length;
    this.selectedIds =
      shift || this.uiState.modernAdditiveSelection
        ? [...new Set([...this.selectedIds, id])]
        : [id];
    this.uiState.modernSelectedForceIds = [...this.selectedIds];
    if (
      (shift || this.uiState.modernAdditiveSelection) &&
      this.selectedIds.length > previousCount
    )
      this.uiState.modernAdditionalSelections =
        (this.uiState.modernAdditionalSelections ?? 0) + 1;
    this.clearPreview();
  }
  private ownedForces(): ModernForceState[] {
    const id = this.game.myPlayer()?.id();
    return (this.systems()?.forces ?? []).filter(
      (force) =>
        force.playerId === id &&
        force.branch === this.branch &&
        force.phase !== "destroyed",
    );
  }
  private clearPreview(): void {
    this.revision++;
    this.preview = null;
    this.previews.clear();
    this.target = null;
    this.pendingCommand = null;
    this.productionPlacement = null;
    this.pendingProductionTile = null;
  }
  private async prepare(
    target: TileRef,
    queue: boolean,
    hover = false,
  ): Promise<boolean> {
    const forces = this.ownedForces().filter((force) =>
      this.selectedIds.includes(force.id),
    );
    if (!forces.length) {
      this.status = translateText("modern_v2.no_units");
      return false;
    }
    const enemy =
      (this.game.ownerID(target) !== 0 &&
        this.game.ownerID(target) !== this.game.myPlayer()?.smallID()) ||
      (this.branch === "navy" &&
        Boolean(
          this.systems()?.forces.some(
            (force) =>
              force.branch === "navy" &&
              force.tile === target &&
              force.playerId !== this.game.myPlayer()?.id() &&
              force.phase !== "destroyed",
          ),
        ));
    const commandFor = (force: ModernForceState): ModernCommandKind =>
      this.operation !== "auto"
        ? this.operation
        : this.branch === "air"
          ? enemy
            ? force.kind === "strike"
              ? "strike"
              : "air_superiority"
            : "patrol"
          : enemy
            ? "attack"
            : "move";
    const revision = ++this.revision;
    this.status = translateText("modern_v2.checking_path");
    try {
      const previews = await queryPreviewBatches(
        forces,
        async (force) => {
          const command = commandFor(force);
          const key = `${this.game.modernForcesTick?.() ?? this.game.ticks()}:${force.id}:${force.tile}:${target}:${command}:${queue}`;
          const cached = this.previewCache.get(key);
          if (cached) {
            this.previewCache.delete(key);
            this.previewCache.set(key, cached);
            return cached;
          }
          const result = await this.queryPreview(
            force.id,
            target,
            command,
            queue,
          );
          if (!this.stopped && revision === this.revision) {
            this.previewCache.set(key, result);
            if (this.previewCache.size > 512)
              this.previewCache.delete(this.previewCache.keys().next().value!);
          }
          return result;
        },
        () => !this.stopped && revision === this.revision,
      );
      if (!previews || this.stopped || revision !== this.revision) return false;
      this.previews = new Map(
        forces.map((force, index) => [
          force.id,
          { preview: previews[index], command: commandFor(force) },
        ]),
      );
      this.preview = previews.find((result) => result.valid) ?? previews[0];
      if (this.branch === "army" && this.preview.valid) {
        if (this.preview.climateEfficiencyPermille > 1000)
          this.uiState.modernClimatePreviewAdapted = true;
        if (this.preview.climateEfficiencyPermille < 1000)
          this.uiState.modernClimatePreviewHarsh = true;
      }
      this.target = target;
      if (
        hover &&
        this.preview.valid &&
        this.lastPreviewEvidenceTarget !== target
      ) {
        this.lastPreviewEvidenceTarget = target;
        this.uiState.modernCursorPreviewCount =
          (this.uiState.modernCursorPreviewCount ?? 0) + 1;
      }
      this.pendingCommand = { command: commandFor(forces[0]), queue };
      this.status = this.preview.valid
        ? translateText("modern_v2.confirm_preview")
        : this.reason(this.preview.reason);
      return this.preview.valid;
    } catch {
      if (!this.stopped && revision === this.revision)
        this.status = translateText("modern_v2.preview_unavailable");
      return false;
    }
  }
  private reason(reason: string | null): string {
    return translateText(`modern_v2.reason.${reason ?? "unknown"}`);
  }
  private canDispatch(): boolean {
    if (!this.game.isPaused()) return true;
    this.status = translateText("modern_v2.paused_commands");
    return false;
  }
  private async prepareNavalBase(tile: TileRef): Promise<boolean> {
    const game = this.game,
      me = game.myPlayer(),
      revision = ++this.revision;
    this.preview = null;
    this.pendingProductionTile = null;
    this.status = translateText("modern_v2.checking_path");
    const current = () =>
      !this.stopped &&
      this.game === game &&
      this.productionPlacement === "navybase" &&
      this.revision === revision;
    const show = (reason: string | null, spawn: TileRef = tile) => {
      if (!current()) return false;
      this.preview = {
        valid: reason === null,
        reason,
        path: [spawn],
        etaTicks: this.productionTicks("navybase"),
        rangeTiles: 0,
        risk: "uncertain",
        climateEfficiencyPermille: 1000,
      };
      this.pendingProductionTile = reason === null ? spawn : null;
      this.status = reason ? this.reason(reason) : this.previewSummary();
      return reason === null;
    };
    if (
      !me ||
      !game.isLand(tile) ||
      game.isImpassable(tile) ||
      game.ownerID(tile) !== me.smallID()
    )
      return show("base_requires_owned_land");
    if (game.config().isUnitDisabled(UnitType.Port))
      return show("navybase_disabled");
    try {
      // Reuse the original Worker/core Port search. A coastal click alone is
      // insufficient: nearby structures can reject or relocate its spawn.
      const buildable = (await me.buildables(tile, [UnitType.Port])).find(
        (item) => item.type === UnitType.Port,
      );
      if (!current()) return false;
      if (!buildable) return show("cost_unavailable");
      // Discard an older price-only query, which must not overwrite this
      // placement's freshly validated native price.
      this.nativeCostsRequest = null;
      this.nativeCosts.set(UnitType.Port, Number(buildable.cost));
      this.nativeCostsTick = game.ticks();
      if (me.gold() < buildable.cost) return show("insufficient_gold");
      const spawn = buildable.canBuild;
      if (
        typeof spawn !== "number" ||
        !game.isValidCoord(game.x(spawn), game.y(spawn)) ||
        !game.isLand(spawn) ||
        game.isImpassable(spawn) ||
        game.ownerID(spawn) !== me.smallID()
      )
        return show("navybase_no_valid_site");
      if (
        this.systems()?.bases.some(
          (base) => base.tile === spawn && base.branch === "navy",
        )
      )
        return show("base_already_exists", spawn);
      return show(null, spawn);
    } catch {
      return show("cost_unavailable");
    }
  }
  private async confirmNavalBase(): Promise<void> {
    if (this.committing || this.pendingProductionTile === null) return;
    const tile = this.pendingProductionTile,
      price = this.productionCost("navybase");
    this.committing = true;
    try {
      const valid = await this.prepareNavalBase(tile);
      // A changed price/site needs a refreshed, explicit confirmation. A
      // paused game, cancelled preview or old response cannot submit a build.
      if (
        valid &&
        this.pendingProductionTile === tile &&
        this.productionCost("navybase") === price &&
        this.canDispatch()
      )
        this.dispatchBaseProduction();
    } finally {
      this.committing = false;
    }
  }
  private dispatchBaseProduction(): void {
    if (!this.productionPlacement || this.pendingProductionTile === null)
      return;
    this.eventBus.emit(
      new SendModernIntentEvent({
        type: "modern_produce",
        branch:
          this.productionPlacement === "armybase"
            ? "army"
            : this.productionPlacement === "navybase"
              ? "navy"
              : "air",
        kind: this.productionPlacement,
        tile: this.pendingProductionTile,
        count: 1,
      }),
    );
    this.uiState.modernTargeting = false;
    this.clearPreview();
    this.status = translateText("modern_v2.production_sent");
  }
  private sendModern(event: SendModernIntentEvent): void {
    if (this.canDispatch()) this.eventBus.emit(event);
  }
  private confirm(): void {
    if (!this.canDispatch()) return;
    if (
      this.productionPlacement &&
      this.preview?.valid &&
      this.pendingProductionTile !== null
    ) {
      if (this.productionPlacement === "navybase") void this.confirmNavalBase();
      else this.dispatchBaseProduction();
      return;
    }
    if (!this.preview?.valid || this.target === null || !this.pendingCommand)
      return;
    const grouped = new Map<ModernCommandKind, string[]>();
    for (const [id, result] of this.previews) {
      if (!result.preview.valid || !this.selectedIds.includes(id)) continue;
      const ids = grouped.get(result.command) ?? [];
      ids.push(id);
      grouped.set(result.command, ids);
    }
    for (const [command, forceIds] of grouped)
      for (const chunk of stableChunks(forceIds))
        this.eventBus.emit(
          new SendModernIntentEvent({
            type: "modern_command",
            forceIds: chunk,
            command,
            target: this.target,
            queue: this.pendingCommand.queue,
          }),
        );
    this.uiState.modernTargeting = false;
    this.clearPreview();
    this.status = translateText("modern_v2.command_sent");
  }
  private control(command: "stop" | "cancel" | "wait"): void {
    if (!this.canDispatch()) return;
    if (!this.selectedIds.length) {
      this.status = translateText("modern_v2.no_units");
      return;
    }
    const first = this.ownedForces().find((force) =>
      this.selectedIds.includes(force.id),
    );
    if (!first) return;
    if (command === "stop" || command === "cancel") {
      for (const force of this.ownedForces()) {
        if (this.selectedIds.includes(force.id) && force.phase !== "idle")
          this.pendingStops.add(force.id);
      }
    }
    for (const forceIds of stableChunks(this.selectedIds))
      this.eventBus.emit(
        new SendModernIntentEvent({
          type: "modern_command",
          forceIds,
          command,
          target: first.tile,
        }),
      );
    this.clearPreview();
  }
  private produce(
    kind:
      | "army"
      | "warship"
      | "fighter"
      | "strike"
      | "airbase"
      | "armybase"
      | "navybase"
      | "repair_base",
  ): void {
    const me = this.game.myPlayer();
    if (!me) return;
    if (kind.endsWith("base") && kind !== "repair_base") {
      if (kind === "navybase" && !this.nativeCosts.has(UnitType.Port)) {
        this.status = this.reason("cost_unavailable");
        this.refreshNativeCosts();
        return;
      }
      this.clearPreview();
      this.expanded = false;
      this.productionPlacement = kind as "armybase" | "navybase" | "airbase";
      this.uiState.modernTargeting = true;
      this.status = translateText("repair.place_base", {
        base: translateText(`modern_v2.kind.${kind}`),
      });
      return;
    }
    if (!this.canDispatch()) return;
    const systems = this.systems();
    const bases =
      systems?.bases.filter(
        (item) =>
          item.playerId === me.id() &&
          item.health > 0 &&
          (item.branch ?? "air") === this.branch,
      ) ?? [];
    const base =
      bases.find((item) => item.id === this.selectedBaseId) ?? bases[0];
    const center = me.nameLocation();
    let tile =
      base?.tile ??
      (center
        ? this.game.ref(Math.round(center.x), Math.round(center.y))
        : undefined);
    if (kind === "warship" && !base)
      tile =
        me
          .units(UnitType.Port)
          .find((port) => port.isActive() && !port.isUnderConstruction())
          ?.tile() ?? tile;
    this.eventBus.emit(
      new SendModernIntentEvent({
        type: "modern_produce",
        branch:
          kind === "army"
            ? "army"
            : kind === "warship"
              ? "navy"
              : kind === "repair_base"
                ? this.branch
                : "air",
        kind,
        baseId: base?.id,
        tile,
        count: 1,
        ...(["army", "warship", "fighter", "strike"].includes(kind) &&
        this.productionManpowerSource !== "auto"
          ? { source: this.productionManpowerSource }
          : {}),
      }),
    );
    this.status = translateText("modern_v2.production_sent");
  }
  private refreshNativeCosts(): void {
    const game = this.game,
      me = game.myPlayer();
    if (
      this.stopped ||
      !me?.buildables ||
      this.nativeCostsRequest !== null ||
      game.ticks() < this.nativeCostsTick + 10
    )
      return;
    const request = ++this.nativeCostsGeneration;
    this.nativeCostsRequest = request;
    this.nativeCostsTick = game.ticks();
    const release = () => {
      if (this.nativeCostsRequest === request) this.nativeCostsRequest = null;
    };
    void me
      .buildables(undefined, [UnitType.Port, UnitType.Warship])
      .then((buildables) => {
        if (
          !this.stopped &&
          this.game === game &&
          this.nativeCostsRequest === request
        ) {
          this.nativeCosts = new Map(
            buildables.map((item) => [item.type, Number(item.cost)]),
          );
          this.requestUpdate();
        }
        release();
      }, release);
  }
  private productionCost(kind: string): number {
    // Costs need core's construction counters, absent from PlayerView. Query
    // the existing bounded Worker buildables API instead of casting the view.
    if (kind === "navybase") return this.nativeCosts.get(UnitType.Port) ?? 0;
    if (kind === "warship") return this.nativeCosts.get(UnitType.Warship) ?? 0;
    if (kind === "army") return DEFAULT_MODERN_FORCE_RULES.armyTrainingCost;
    if (kind === "repair_base")
      return DEFAULT_MODERN_FORCE_RULES.baseRepairCost;
    return DEFAULT_MODERN_FORCE_RULES[`${kind}Cost` as "fighterCost"] ?? 0;
  }
  private productionTicks(kind: string): number {
    if (kind === "army") return DEFAULT_MODERN_FORCE_RULES.armyTrainingTicks;
    if (kind === "warship")
      return DEFAULT_MODERN_FORCE_RULES.warshipProductionTicks;
    if (kind === "repair_base")
      return DEFAULT_MODERN_FORCE_RULES.baseRepairTicks;
    if (kind.endsWith("base"))
      return DEFAULT_MODERN_FORCE_RULES[
        `${kind}BuildTicks` as "airbaseBuildTicks"
      ];
    return (
      DEFAULT_MODERN_FORCE_RULES.aircraftProductionTicks +
      DEFAULT_MODERN_FORCE_RULES.aircraftProductionTicksPerAircraft
    );
  }
  private branchBase() {
    const bases =
      this.systems()?.bases.filter(
        (base) =>
          base.playerId === this.game.myPlayer()?.id() &&
          (base.branch ?? "air") === this.branch,
      ) ?? [];
    return bases.find((base) => base.id === this.selectedBaseId) ?? bases[0];
  }
  private baseCapacityUsed(baseId: string): number {
    const state = this.systems();
    const units = (state?.forces ?? [])
      .filter((force) => force.baseId === baseId && force.phase !== "destroyed")
      .reduce(
        (sum, force) =>
          sum +
          (this.branch === "army"
            ? force.personnel +
              Math.floor(force.attackTroops / MODERN_RULES.rawTroopsPerPerson)
            : this.branch === "air"
              ? force.aircraft
              : 1),
        0,
      );
    return (
      units +
      (state?.production ?? [])
        .filter((job) => job.baseId === baseId)
        .reduce(
          (sum, job) =>
            sum + (this.branch === "army" ? job.personnel : job.count),
          0,
        )
    );
  }
  private productionReason(kind: string): string | null {
    const me = this.game.myPlayer();
    if (!me) return "not_owner";
    if (
      (kind === "navybase" && !this.nativeCosts.has(UnitType.Port)) ||
      (kind === "warship" && !this.nativeCosts.has(UnitType.Warship))
    )
      return "cost_unavailable";
    if (me.gold() < BigInt(this.productionCost(kind)))
      return "insufficient_gold";
    if (kind.endsWith("base") && kind !== "repair_base") return null;
    const base = this.branchBase();
    if (!base)
      return this.branch === "air"
        ? "airbase_unavailable"
        : this.branch === "army"
          ? "armybase_unavailable"
          : "warship_requires_port";
    if (kind === "repair_base")
      return base.health >= base.maxHealth ? "base_damaged_or_repairing" : null;
    if ((base.completesTick ?? 0) > this.game.ticks())
      return "base_under_construction";
    if (base.health <= 0 || (base.repairUntilTick ?? 0) > this.game.ticks())
      return "base_damaged_or_repairing";
    const personnel =
      this.branch === "army"
        ? DEFAULT_MODERN_FORCE_RULES.armyPersonnelPerGroup
        : this.branch === "navy"
          ? DEFAULT_MODERN_FORCE_RULES.navyPersonnelPerWarship
          : DEFAULT_MODERN_FORCE_RULES.personnelPerAircraft;
    const faction = this.systems()?.factions.find(
      (item) => item.playerId === me.id(),
    );
    const reserveRequired =
      this.effectiveProductionSource(personnel) === "army_reserve";
    if (reserveRequired) {
      if (me.troops() < personnel * MODERN_RULES.rawTroopsPerPerson)
        return "insufficient_army_reserve";
    } else if (faction) {
      if (faction.population.available < personnel)
        return "insufficient_manpower";
      if (
        this.systems()?.version === 3 &&
        faction.population.army +
          faction.population.navy +
          faction.population.air +
          personnel >
          Math.floor(
            (faction.population.total * MODERN_RULES.mobilizationPermille) /
              1000,
          )
      )
        return "mobilization_limit";
    }
    if (
      this.baseCapacityUsed(base.id) +
        (this.branch === "army" ? personnel : 1) >
      base.capacity
    )
      return "base_capacity";
    if (
      this.branch === "navy" &&
      this.game.config().isUnitDisabled(UnitType.Warship)
    )
      return "warship_disabled_or_count";
    return null;
  }
  private effectiveProductionSource(
    personnel: number,
  ): "army_reserve" | "available" {
    if (this.systems()?.version !== 3)
      return this.branch === "army" ? "army_reserve" : "available";
    if (this.productionManpowerSource !== "auto")
      return this.productionManpowerSource;
    const me = this.game.myPlayer();
    if (this.branch === "army")
      return (me?.troops() ?? 0) >= personnel * MODERN_RULES.rawTroopsPerPerson
        ? "army_reserve"
        : "available";
    const population = this.systems()?.factions.find(
      (item) => item.playerId === me?.id(),
    )?.population;
    const cannotMobilize =
      population &&
      (population.available < personnel ||
        population.army + population.navy + population.air + personnel >
          Math.floor(
            (population.total * MODERN_RULES.mobilizationPermille) / 1000,
          ));
    return cannotMobilize ? "army_reserve" : "available";
  }
  private manpowerSummary(): string {
    const me = this.game.myPlayer();
    const personnel =
      this.branch === "army"
        ? DEFAULT_MODERN_FORCE_RULES.armyPersonnelPerGroup
        : this.branch === "navy"
          ? DEFAULT_MODERN_FORCE_RULES.navyPersonnelPerWarship
          : DEFAULT_MODERN_FORCE_RULES.personnelPerAircraft;
    return translateText("repair.manpower_source_effective", {
      pool: translateText(
        this.effectiveProductionSource(personnel) === "army_reserve"
          ? "repair.manpower_source_reserve"
          : "repair.manpower_source_available",
      ),
      people: personnel,
      available:
        this.systems()?.factions.find((item) => item.playerId === me?.id())
          ?.population.available ?? 0,
      reserve: Math.floor(
        (me?.troops() ?? 0) / MODERN_RULES.rawTroopsPerPerson,
      ),
    });
  }
  private baseDetails() {
    const base = this.branchBase();
    if (!base)
      return html`<p class="text-xs">
        ${translateText("repair.no_branch_units")}
      </p>`;
    return html`<p class="text-xs">
        ${translateText("repair.base_status", {
          base: translateText(`modern_v2.kind.${this.branch}base`),
          used: this.baseCapacityUsed(base.id),
          capacity: base.capacity,
          health: base.health,
          maxHealth: base.maxHealth,
          seconds: Math.max(
            0,
            Math.ceil(
              (Math.max(base.completesTick ?? 0, base.repairUntilTick ?? 0) -
                this.game.ticks()) /
                10,
            ),
          ),
        })}
      </p>
      ${base.health < base.maxHealth
        ? html`<button
            class="text-xs border border-slate-500 rounded-md p-1"
            @click=${() => this.produce("repair_base")}
          >
            ${translateText("modern_v2.kind.repair_base")} ·
            ${renderNumber(DEFAULT_MODERN_FORCE_RULES.baseRepairCost)}
          </button>`
        : nothing}`;
  }
  private forceTile(force: ModernForceState): TileRef {
    const unit =
      force.unitId === null || force.unitId === undefined
        ? undefined
        : this.game.unit?.(force.unitId);
    return unit?.isActive() ? unit.tile() : force.tile;
  }
  private commandSegments(
    key: string,
    path: TileRef[],
    branch: ModernBranch,
    start?: TileRef,
    index = 0,
  ): ArrowSegment[] {
    const cached = this.arrowCache.get(key);
    if (cached?.path === path) {
      this.arrowCache.delete(key);
      this.arrowCache.set(key, cached);
      return cached.segments;
    }
    if (start !== undefined) {
      const liveIndex = path.indexOf(start, index);
      if (liveIndex >= 0) index = liveIndex;
    }
    const tiles =
      start === undefined ? path : [start, ...path.slice(index + 1)];
    const segments = curvedPath(
      tiles.map((tile) => ({
        x: this.game.x(tile) + 0.5,
        y: this.game.y(tile) + 0.5,
      })),
      (point) => {
        if (branch === "air") return true;
        const x = Math.floor(point.x),
          y = Math.floor(point.y);
        if (!this.game.isValidCoord(x, y)) return false;
        const tile = this.game.ref(x, y);
        return branch === "navy"
          ? this.game.isWater(tile) || this.game.isShoreline(tile)
          : this.game.isLand(tile) && !this.game.isImpassable(tile);
      },
    );
    this.arrowCache.set(key, { path, segments });
    if (this.arrowCache.size > 1024)
      this.arrowCache.delete(this.arrowCache.keys().next().value!);
    return segments;
  }
  private readonly draw = () => {
    if (this.stopped || !this.canvas) return;
    const canvas = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (
      canvas.width !== Math.round(innerWidth * dpr) ||
      canvas.height !== Math.round(innerHeight * dpr)
    ) {
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (this.climateOverlay) {
        if (!this.climateCanvas) {
          this.climateCanvas = document.createElement("canvas");
          this.climateCanvas.width = modernRegions.width;
          this.climateCanvas.height = modernRegions.height;
          const image = this.climateCanvas
            .getContext("2d")!
            .createImageData(modernRegions.width, modernRegions.height);
          const colors = [
            [0, 0, 0],
            [235, 185, 60],
            [76, 199, 110],
            [90, 176, 229],
            [162, 144, 215],
            [224, 240, 250],
          ];
          for (const [
            climateIndex,
            start,
            count,
          ] of modernRegions.climateRuns) {
            const color = colors[climateIndex] ?? colors[0];
            for (let tile = start; tile < start + count; tile++) {
              image.data[tile * 4] = color[0];
              image.data[tile * 4 + 1] = color[1];
              image.data[tile * 4 + 2] = color[2];
              image.data[tile * 4 + 3] = 110;
            }
          }
          this.climateCanvas.getContext("2d")!.putImageData(image, 0, 0);
        }
        const origin = this.transform.worldToScreenCoordinates(new Cell(0, 0));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          this.climateCanvas,
          origin.x,
          origin.y,
          this.game.width() * this.transform.scale,
          this.game.height() * this.transform.scale,
        );
      }
      ctx.lineWidth = 2;
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      const systems = this.systems();
      const me = this.game.myPlayer()?.id();
      const screen = (point: { x: number; y: number }) =>
        this.transform.worldToScreenCoordinates(new Cell(point.x, point.y));
      const visible = (point: { x: number; y: number }) =>
        point.x >= -20 &&
        point.y >= -20 &&
        point.x <= innerWidth + 20 &&
        point.y <= innerHeight + 20;
      for (const base of systems?.bases ?? []) {
        // Naval bases are the original Port facility, already rendered by GL.
        if (
          base.branch === "navy" ||
          base.health <= 0 ||
          (this.transform.scale < 2 && base.playerId !== me)
        )
          continue;
        const point = screen({
          x: this.game.x(base.tile) + 0.5,
          y: this.game.y(base.tile) + 0.5,
        });
        if (!visible(point)) continue;
        const icon = modernMapImage(
          (base.branch ?? "air") === "army" ? "armybase" : "airbase",
        );
        ctx.globalAlpha =
          (base.completesTick ?? 0) > this.game.ticks() ? 0.55 : 1;
        if (icon.complete && icon.naturalWidth)
          ctx.drawImage(icon, point.x - 13, point.y - 13, 26, 26);
        ctx.globalAlpha = 1;
        if (base.playerId === me && this.transform.scale >= 4) {
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#101820";
          const name = translateText(
            `modern_v2.kind.${base.branch === "army" ? "armybase" : "airbase"}`,
          );
          ctx.strokeText(name, point.x, point.y + 24);
          ctx.fillText(name, point.x, point.y + 24);
        }
      }
      if (
        this.productionPlacement === "navybase" &&
        this.preview?.valid &&
        this.pendingProductionTile !== null
      ) {
        const tile = this.pendingProductionTile,
          point = screen({
            x: this.game.x(tile) + 0.5,
            y: this.game.y(tile) + 0.5,
          }),
          icon = modernMapImage("navybase");
        if (visible(point) && icon.complete && icon.naturalWidth) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.drawImage(icon, point.x - 13, point.y - 13, 26, 26);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#fff799";
          ctx.strokeRect(point.x - 15, point.y - 15, 30, 30);
          ctx.restore();
        }
      }
      for (const force of systems?.forces ?? []) {
        if (
          force.phase === "destroyed" ||
          (this.transform.scale < 2 &&
            force.playerId !== me &&
            force.phase === "idle")
        )
          continue;
        const point = screen({
          x: this.game.x(this.forceTile(force)) + 0.5,
          y: this.game.y(this.forceTile(force)) + 0.5,
        });
        const own = force.playerId === me,
          selected = own && this.selectedIds.includes(force.id);
        if (selected) {
          if (force.command && force.path.length) {
            const liveTile = this.forceTile(force);
            const key = `active:${force.id}:${liveTile}:${force.pathIndex}`;
            drawCommandArrow(
              ctx,
              this.commandSegments(
                key,
                force.path,
                force.branch,
                liveTile,
                force.pathIndex,
              ),
              screen,
              force.branch,
              "active",
              ["attack", "strike", "blockade"].includes(force.command.kind),
            );
          }
          const result = this.previews.get(force.id);
          if (result?.preview.valid) {
            drawCommandArrow(
              ctx,
              this.commandSegments(
                `preview:${force.id}`,
                result.preview.path,
                force.branch,
              ),
              screen,
              force.branch,
              "preview",
              ["attack", "strike", "blockade"].includes(result.command),
            );
            if (result.preview.transportPath?.length)
              drawCommandArrow(
                ctx,
                this.commandSegments(
                  `transport:${force.id}`,
                  result.preview.transportPath,
                  "navy",
                ),
                screen,
                "navy",
                "preview",
              );
          }
          // The core records only validated queued routes, and checks them
          // again on activation. Older saves keep destination markers only.
          for (let index = 0; index < force.queue.length; index++) {
            const order = force.queue[index];
            if (order.previewPath?.length)
              drawCommandArrow(
                ctx,
                this.commandSegments(
                  `queued:${force.id}:${index}`,
                  order.previewPath,
                  force.branch,
                ),
                screen,
                force.branch,
                "queued",
                ["strike", "attack", "blockade"].includes(order.kind),
              );
            const destination = screen({
              x: this.game.x(order.target),
              y: this.game.y(order.target),
            });
            ctx.strokeStyle = "#fff799";
            ctx.setLineDash([2, 4]);
            ctx.strokeRect(destination.x - 7, destination.y - 7, 14, 14);
            ctx.setLineDash([]);
            ctx.fillStyle = "#fff799";
            ctx.fillText(`${index + 1}`, destination.x, destination.y - 10);
          }
          if (force.branch === "air") {
            const base = systems?.bases.find(
              (entry) => entry.id === force.baseId,
            );
            if (base) {
              const center = screen({
                x: this.game.x(base.tile) + 0.5,
                y: this.game.y(base.tile) + 0.5,
              });
              ctx.strokeStyle = "#89d8ff66";
              ctx.setLineDash([4, 8]);
              ctx.beginPath();
              ctx.arc(
                center.x,
                center.y,
                DEFAULT_MODERN_FORCE_RULES.airRangeTiles * this.transform.scale,
                0,
                Math.PI * 2,
              );
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
        if (!visible(point)) continue;
        // Native warships/transports retain their original sprite, one unit.
        if (
          force.branch !== "navy" &&
          !(
            force.branch === "army" &&
            force.unitId !== null &&
            force.command?.viaTransport
          )
        ) {
          const icon = modernMapImage(force.branch);
          ctx.save();
          if (force.branch === "army")
            ctx.filter =
              "brightness(0) invert(1) drop-shadow(0 1px 1px #101820)";
          if (icon.complete && icon.naturalWidth)
            ctx.drawImage(icon, point.x - 12, point.y - 12, 24, 24);
          ctx.restore();
        }
        if (selected) {
          ctx.strokeStyle = "#fff799";
          ctx.lineWidth = 2;
          ctx.strokeRect(point.x - 15, point.y - 15, 30, 30);
        }
        if (own && this.transform.scale >= 4) {
          ctx.strokeStyle = "#101820";
          ctx.lineWidth = 3;
          const label = `${translateText(`modern_v2.kind.${force.kind}`)} ${force.branch === "air" ? force.aircraft : renderNumber(force.personnel + Math.floor(force.attackTroops / MODERN_RULES.rawTroopsPerPerson))}`;
          ctx.strokeText(label, point.x, point.y + 30);
          ctx.fillStyle = "white";
          ctx.fillText(label, point.x, point.y + 30);
          ctx.lineWidth = 2;
        }
      }
      if (this.preview && !this.preview.valid && this.selectedIds.length) {
        const text = this.reason(this.preview.reason);
        ctx.font = "12px sans-serif";
        const width = Math.min(320, ctx.measureText(text).width + 16);
        const x = Math.min(innerWidth - width - 8, this.cursor.x + 14),
          y = Math.max(20, this.cursor.y - 16);
        ctx.fillStyle = "#1e1e1eee";
        ctx.fillRect(x, y - 16, width, 24);
        ctx.fillStyle = "#fca5a5";
        ctx.textAlign = "left";
        ctx.fillText(text, x + 8, y, width - 16);
        ctx.textAlign = "center";
      }
      if (this.selectionBox) {
        const box = this.selectionBox;
        ctx.strokeStyle = "#fff799";
        ctx.fillStyle = "#fff79922";
        ctx.fillRect(
          box.startX,
          box.startY,
          box.endX - box.startX,
          box.endY - box.startY,
        );
        ctx.strokeRect(
          box.startX,
          box.startY,
          box.endX - box.startX,
          box.endY - box.startY,
        );
      }
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  render() {
    const systems = this.systems();
    const me = this.game.myPlayer();
    const faction = systems?.factions.find(
      (entry) => entry.playerId === me?.id(),
    );
    const forces = this.ownedForces();
    const keys = modernKeybinds(this.userSettings, Platform.isMac);
    const ports =
      systems?.ports.filter((port) => port.ownerId === me?.id()) ?? [];
    const port =
      ports.find((entry) => entry.portId === this.portId) ?? ports[0];
    const nuclear = nuclearEffects(faction, this.game.ticks());
    return html`<section
      aria-label=${translateText("modern_v2.commands")}
      class="pointer-events-auto text-white px-2 py-1 border-t border-gray-600"
      style="max-height:47dvh;overflow:auto"
    >
      <div class="flex gap-1 justify-between">
        ${(["army", "navy", "air"] as const).map(
          (branch) =>
            html`<button
              class="flex flex-1 items-center justify-center gap-1 py-1 px-2 rounded-md border hover:bg-gray-600 ${this
                .branch === branch
                ? "border-yellow-400 bg-gray-600"
                : "border-slate-500 bg-gray-700/50"}"
              data-modern-branch=${branch}
              data-modern-highlight=${branch}
              aria-pressed=${this.branch === branch}
              @click=${() => this.eventBus.emit(new ModernBranchEvent(branch))}
            >
              <img
                src=${MODERN_ICONS[branch]}
                width="18"
                height="18"
                alt=""
                style=${branch === "army"
                  ? "filter:brightness(0) invert(1)"
                  : ""}
              />
              ${translateText(`modern_v2.branch.${branch}`)}
              <small
                >${formatKeyForDisplay(
                  keys[`modern${branch[0].toUpperCase()}${branch.slice(1)}`] ??
                    "",
                ) || translateText("education.unbound")}</small
              >
              <span class="text-[10px] tabular-nums"
                >${(systems?.forces ?? []).filter(
                  (force) =>
                    force.playerId === me?.id() &&
                    force.branch === branch &&
                    force.phase !== "destroyed",
                ).length}</span
              >
            </button>`,
        )}
        <button
          @click=${() => (this.minimized = !this.minimized)}
          aria-expanded=${!this.minimized}
          aria-label=${translateText("modern_v2.minimize")}
          class="px-1 py-1 border border-slate-500 rounded-md bg-gray-700/50 hover:bg-gray-600"
        >
          ${this.minimized ? "+" : "−"}
        </button>
        <button
          @click=${() => (this.expanded = !this.expanded)}
          aria-expanded=${this.expanded}
          class="px-2 py-1 border border-slate-500 rounded-md bg-gray-700/50 hover:bg-gray-600"
          data-modern-highlight="production"
          title=${translateText("repair.production_title")}
        >
          <img
            src=${MODERN_ICONS[
              this.branch === "army"
                ? "armybase"
                : this.branch === "navy"
                  ? "navybase"
                  : "airbase"
            ]}
            width="18"
            height="18"
            alt=""
          />
          <span class="text-[10px]"
            >${translateText("repair.production_title")}</span
          >
        </button>
      </div>
      <div ?hidden=${this.minimized}>
        <p class="text-xs my-1">
          ${translateText("modern_v2.selected", {
            count: this.selectedIds.length,
          })}
          · ${translateText("modern_v2.input_hint")}
        </p>
        <div class="flex flex-wrap gap-1 text-xs">
          <button
            data-modern-highlight="selection"
            class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
            @click=${() => {
              this.onVisible();
            }}
          >
            ${translateText("modern_v2.select_all")}
          </button>
          <button
            data-modern-highlight="additional"
            class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
            aria-pressed=${Boolean(this.uiState.modernAdditiveSelection)}
            @click=${() => {
              this.uiState.modernAdditiveSelection =
                !this.uiState.modernAdditiveSelection;
              this.requestUpdate();
            }}
          >
            ${translateText("repair.additional_selection")}
          </button>
          <button
            class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
            aria-pressed=${Boolean(this.uiState.modernQueueCommand)}
            @click=${() => {
              this.uiState.modernQueueCommand =
                !this.uiState.modernQueueCommand;
              this.requestUpdate();
            }}
          >
            ${translateText("repair.queue_command")}
          </button>
          <button
            class="bg-gray-700/50 border border-slate-500 rounded-md p-1"
            @click=${() => {
              const force = forces.find((item) =>
                this.selectedIds.includes(item.id),
              );
              const center = me?.nameLocation();
              const point = force
                ? this.transform.worldToScreenCoordinates(
                    new Cell(
                      this.game.x(this.forceTile(force)) + 0.5,
                      this.game.y(this.forceTile(force)) + 0.5,
                    ),
                  )
                : center
                  ? this.transform.worldToScreenCoordinates(
                      new Cell(center.x, center.y),
                    )
                  : this.cursor;
              this.eventBus.emit(new ShowBuildMenuEvent(point.x, point.y));
            }}
          >
            ${translateText("repair.build_menu")}
          </button>
          <button
            class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
            aria-pressed=${Boolean(this.uiState.modernTargeting)}
            @click=${() => {
              this.inspectTarget = false;
              this.uiState.modernTargeting = !this.uiState.modernTargeting;
              this.requestUpdate();
            }}
          >
            ${translateText("modern_v2.touch_target")}
          </button>
          <button
            class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
            aria-pressed=${this.inspectTarget}
            @click=${() => {
              this.inspectTarget = !this.inspectTarget;
              this.uiState.modernTargeting = this.inspectTarget;
            }}
          >
            ${translateText("modern_v2.country_info")}
          </button>
          ${(["stop", "cancel", "wait"] as const).map(
            (command) =>
              html`<button
                data-modern-highlight=${command}
                class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 p-1 rounded-md"
                @click=${() => this.control(command)}
              >
                ${translateText(`modern_v2.operation.${command}`)}
              </button>`,
          )}
          <select
            class="bg-gray-800"
            aria-label=${translateText("modern_v2.operation_label")}
            .value=${this.operation}
            @change=${(event: Event) => {
              this.operation = (event.target as HTMLSelectElement)
                .value as typeof this.operation;
              this.clearPreview();
            }}
          >
            ${(this.branch === "army"
              ? ["auto", "move", "attack"]
              : this.branch === "navy"
                ? ["auto", "move", "attack", "patrol", "escort", "blockade"]
                : ["auto", "patrol", "air_superiority", "intercept", "strike"]
            ).map(
              (command) =>
                html`<option
                  value=${command}
                  ?selected=${command === this.operation}
                >
                  ${translateText(`modern_v2.operation.${command}`)}
                </option>`,
            )}
          </select>
        </div>
        <p class="text-xs h-4 truncate" title=${this.previewSummary()}>
          ${this.previewSummary()}
        </p>
        ${(this.productionPlacement || this.uiState.modernTargeting) &&
        this.preview
          ? html` <button
              class="bg-gray-700/50 border border-slate-500 p-1 mt-1 rounded-md disabled:opacity-50"
              ?disabled=${!this.preview.valid}
              @click=${this.confirm}
            >
              ${translateText(
                this.productionPlacement
                  ? "repair.confirm_base"
                  : "modern_v2.confirm",
              )}
            </button>`
          : nothing}
        <p
          role="status"
          class="text-xs h-4 truncate text-yellow-200 my-1"
          title=${this.status}
        >
          ${this.status}
        </p>
        ${modernNuclearNotice(this.game, this.uiState.ghostStructure)
          ? html`<p class="text-xs text-orange-200">
              ${modernNuclearNotice(this.game, this.uiState.ghostStructure)}
            </p>`
          : nothing}
        ${this.expanded
          ? html`
              <ul class="text-xs space-y-1">
                ${forces.map(
                  (force) =>
                    html`<li>
                      <button
                        class="underline"
                        aria-pressed=${this.selectedIds.includes(force.id)}
                        @click=${(event: MouseEvent) =>
                          this.selectFromRoster(force.id, event.shiftKey)}
                      >
                        ${translateText(`modern_v2.kind.${force.kind}`)}
                        ${force.id} ·
                        ${force.personnel +
                        Math.floor(
                          force.attackTroops / MODERN_RULES.rawTroopsPerPerson,
                        )}
                        · ${translateText(`modern_v2.phase.${force.phase}`)}
                      </button>
                      ${force.lastReason ? this.reason(force.lastReason) : ""}
                      ${force.cooldownUntil > this.game.ticks()
                        ? translateText("modern_v2.rearm", {
                            seconds: Math.ceil(
                              (force.cooldownUntil - this.game.ticks()) / 10,
                            ),
                          })
                        : ""}
                    </li>`,
                )}
              </ul>
              <p class="text-xs mt-2">
                ${translateText("modern_v2.production_hint")}
              </p>
              <p class="text-xs mt-1">${translateText("repair.base_rules")}</p>
              <select
                class="bg-gray-800 text-xs mb-1 w-full"
                aria-label=${translateText("modern_v2.base_choice")}
                .value=${this.selectedBaseId}
                @change=${(event: Event) =>
                  (this.selectedBaseId = (
                    event.target as HTMLSelectElement
                  ).value)}
              >
                ${(systems?.bases ?? [])
                  .filter(
                    (base) =>
                      base.playerId === me?.id() &&
                      (base.branch ?? "air") === this.branch,
                  )
                  .map(
                    (base) =>
                      html`<option
                        value=${base.id}
                        ?selected=${base.id === this.selectedBaseId}
                      >
                        ${translateText(`modern_v2.kind.${this.branch}base`)}
                        ${base.id} · ${base.capacity} ·
                        ${base.health}/${base.maxHealth} ·
                        ${Math.max(
                          0,
                          Math.ceil(
                            ((base.completesTick ?? 0) - this.game.ticks()) /
                              10,
                          ),
                        )}s
                      </option>`,
                  )}
              </select>
              ${this.branch === "army" || systems?.version === 3
                ? html`<select
                    class="bg-gray-800 text-xs mb-1 w-full"
                    aria-label=${translateText("repair.manpower_source_auto")}
                    .value=${this.productionManpowerSource}
                    @change=${(event: Event) =>
                      (this.productionManpowerSource = (
                        event.target as HTMLSelectElement
                      ).value as "auto" | "army_reserve" | "available")}
                  >
                    <option value="auto">
                      ${translateText("repair.manpower_source_auto")}
                    </option>
                    <option value="army_reserve">
                      ${translateText("repair.manpower_source_reserve")}
                    </option>
                    ${systems?.version === 3
                      ? html`<option value="available">
                          ${translateText("repair.manpower_source_available")}
                        </option>`
                      : nothing}
                  </select>`
                : nothing}
              <p class="text-xs mb-1">${this.manpowerSummary()}</p>
              ${this.baseDetails()}
              <div class="flex gap-1 flex-wrap text-xs">
                ${(this.branch === "army"
                  ? ["armybase", "army"]
                  : this.branch === "navy"
                    ? ["navybase", "warship"]
                    : ["airbase", "fighter", "strike"]
                ).map((kind) => {
                  const cost = this.productionCost(kind),
                    reason = this.productionReason(kind);
                  return html`<button
                    class="bg-gray-700/50 border border-slate-500 hover:bg-gray-600 rounded-md p-2 disabled:opacity-50"
                    data-modern-highlight=${kind}
                    title=${reason
                      ? this.reason(reason)
                      : translateText("repair.production_detail", {
                          gold: cost,
                          seconds: this.productionTicks(kind) / 10,
                          personnel:
                            kind === "army"
                              ? DEFAULT_MODERN_FORCE_RULES.armyPersonnelPerGroup
                              : kind === "warship"
                                ? DEFAULT_MODERN_FORCE_RULES.navyPersonnelPerWarship
                                : ["fighter", "strike"].includes(kind)
                                  ? DEFAULT_MODERN_FORCE_RULES.personnelPerAircraft
                                  : 0,
                        })}
                    ?disabled=${Boolean(reason)}
                    @click=${() =>
                      this.produce(
                        kind as
                          | "army"
                          | "warship"
                          | "fighter"
                          | "strike"
                          | "armybase"
                          | "navybase"
                          | "airbase",
                      )}
                  >
                    <img
                      src=${MODERN_ICONS[
                        kind.endsWith("base")
                          ? (kind as "armybase" | "navybase" | "airbase")
                          : this.branch
                      ]}
                      width="20"
                      height="20"
                      alt=""
                      style=${kind === "army"
                        ? "filter:brightness(0) invert(1)"
                        : ""}
                    />
                    ${translateText(`modern_v2.kind.${kind}`)} ·
                    ${renderNumber(cost)}
                    <span class="block"
                      >${this.productionTicks(kind) / 10}s</span
                    >
                  </button>`;
                })}
              </div>
              ${(systems?.production ?? [])
                .filter(
                  (job) =>
                    job.playerId === me?.id() && job.branch === this.branch,
                )
                .map(
                  (job) =>
                    html`<p class="text-xs mt-1">
                      ${translateText("repair.production_queue", {
                        kind: translateText(`modern_v2.kind.${job.kind}`),
                        seconds: Math.max(
                          0,
                          Math.ceil(
                            (job.completesTick - this.game.ticks()) / 10,
                          ),
                        ),
                      })}
                    </p>`,
                )}
              ${faction
                ? html`<details class="text-xs mt-2">
                    <summary>
                      ${translateText("modern_v2.population")}:
                      ${renderNumber(faction.population.total)}
                    </summary>
                    <p>
                      ${translateText("modern_v2.ledger", {
                        civilian: faction.population.civilian,
                        available: faction.population.available,
                        army: faction.population.army,
                        navy: faction.population.navy,
                        air: faction.population.air,
                        dead: faction.population.dead,
                      })}
                    </p>
                    <p>
                      ${translateText("modern_v2.army_reserve", {
                        troops: renderNumber(
                          (me?.troops() ?? 0) / MODERN_RULES.rawTroopsPerPerson,
                        ),
                      })}
                    </p>
                    <p>
                      ${translateText("modern_v2.adaptation")}:
                      ${faction.climateAdaptation
                        .map((climate) =>
                          translateText(`modern_v2.climate.${climate}`),
                        )
                        .join(", ")}
                    </p>
                    <select
                      class="bg-gray-800"
                      aria-label=${translateText("modern_v2.train_climate")}
                      .value=${this.climate}
                      @change=${(event: Event) =>
                        (this.climate = (
                          event.target as HTMLSelectElement
                        ).value)}
                    >
                      ${[
                        "arid",
                        "tropical",
                        "temperate",
                        "continental",
                        "polar",
                      ].map(
                        (climate) =>
                          html`<option
                            value=${climate}
                            ?selected=${climate === this.climate}
                          >
                            ${translateText(`modern_v2.climate.${climate}`)}
                          </option>`,
                      )}
                    </select>
                    <button
                      class="p-1 bg-gray-700 rounded"
                      @click=${() =>
                        this.sendModern(
                          new SendModernIntentEvent({
                            type: "modern_train",
                            climate: this.climate as "temperate",
                          }),
                        )}
                    >
                      ${translateText("modern_v2.train_action", {
                        cost: MODERN_RULES.climateTrainingGold,
                        seconds: MODERN_RULES.climateTrainingTicks / 10,
                      })}
                    </button>
                    ${faction.climateTraining
                      ? html`<p>
                          ${translateText("modern_v2.training_remaining", {
                            seconds: Math.max(
                              0,
                              Math.ceil(
                                (faction.climateTraining.completesTick -
                                  this.game.ticks()) /
                                  10,
                              ),
                            ),
                          })}
                        </p>`
                      : nothing}
                  </details>`
                : nothing}
              ${port
                ? html`<details class="text-xs mt-2">
                    <summary>${translateText("modern_v2.major_ports")}</summary>
                    <select
                      class="bg-gray-800 w-full"
                      aria-label=${translateText("modern_v2.port_choice")}
                      .value=${port.portId}
                      @change=${(event: Event) =>
                        (this.portId = (
                          event.target as HTMLSelectElement
                        ).value)}
                    >
                      ${ports.map(
                        (entry) =>
                          html`<option
                            value=${entry.portId}
                            ?selected=${entry.portId === port.portId}
                          >
                            ${entry.name}
                          </option>`,
                      )}
                    </select>
                    <p>
                      ${translateText("modern_v2.port_status", {
                        level: port.level,
                        income: port.incomePerSecond,
                        damage: Math.round(port.damage / 10),
                        blockades: port.blockadedBy.length,
                      })}
                    </p>
                    ${port.repairUntilTick !== null
                      ? html`<p>
                          ${translateText("modern_v2.training_remaining", {
                            seconds: Math.max(
                              0,
                              Math.ceil(
                                (port.repairUntilTick - this.game.ticks()) / 10,
                              ),
                            ),
                          })}
                        </p>`
                      : port.damage > 0
                        ? html`<button
                            class="p-1 bg-gray-700 rounded"
                            @click=${() =>
                              this.sendModern(
                                new SendModernIntentEvent({
                                  type: "modern_repair",
                                  portId: port.portId,
                                }),
                              )}
                          >
                            ${translateText("modern_v2.repair_port", {
                              cost: MODERN_RULES.portRepairGold,
                              seconds: MODERN_RULES.portRepairTicks / 10,
                            })}
                          </button>`
                        : nothing}
                    ${port.development
                      ? html`<p>
                          ${translateText("modern_v2.training_remaining", {
                            seconds: Math.max(
                              0,
                              Math.ceil(
                                (port.development.completesTick -
                                  this.game.ticks()) /
                                  10,
                              ),
                            ),
                          })}
                        </p>`
                      : html`<button
                          class="p-1 bg-gray-700 rounded"
                          ?disabled=${port.level >= 3}
                          @click=${() =>
                            this.sendModern(
                              new SendModernIntentEvent({
                                type: "modern_develop",
                                portId: port.portId,
                              }),
                            )}
                        >
                          ${translateText("modern_v2.develop_port", {
                            cost:
                              MODERN_RULES.portDevelopmentGold[port.level] ?? 0,
                            increase:
                              (((MODERN_RULES.portLevelEfficiencyPermille[
                                port.level + 1
                              ] ?? 0) -
                                (MODERN_RULES.portLevelEfficiencyPermille[
                                  port.level
                                ] ?? 0)) *
                                MODERN_RULES.portBaseIncomePerSecond) /
                              1000,
                          })}
                        </button>`}
                  </details>`
                : html`<p class="text-xs mt-2">
                    ${translateText("modern_v2.landlocked")}
                  </p>`}
              ${nuclear.launches
                ? html`<p class="text-xs mt-2 text-orange-200">
                    ${translateText("modern_v2.nuclear_status", {
                      seconds: Math.ceil(
                        (nuclear.expiresTick - this.game.ticks()) / 10,
                      ),
                      economy: nuclear.incomeLossPermille / 10,
                      replenishment: nuclear.replenishmentLossPermille / 10,
                    })}
                  </p>`
                : nothing}
              <button
                class="text-xs underline mt-2"
                @click=${() => {
                  document
                    .querySelector<HelpModal>("help-modal")
                    ?.openControls();
                }}
              >
                ${translateText("modern_v2.keys")}
              </button>
              <label class="text-xs ml-2"
                ><input
                  type="checkbox"
                  .checked=${this.climateOverlay}
                  @change=${(event: Event) =>
                    (this.climateOverlay = (
                      event.target as HTMLInputElement
                    ).checked)}
                />${translateText("modern_v2.climate_overlay")}</label
              >
              ${this.climateOverlay
                ? html`<p class="text-xs mt-1">
                    ${translateText("modern_v2.climate_legend")}
                  </p>`
                : nothing}
              <button
                class="text-xs underline ml-2"
                @click=${() =>
                  document
                    .querySelector<HelpModal>("help-modal")
                    ?.openFeature("modern_commands")}
              >
                ${translateText("main.help")}
              </button>
            `
          : nothing}
      </div>
    </section>`;
  }
}

export function mountModernCommandPanel(
  game: GameView,
  transform: TransformHandler,
  uiState: UIState,
  eventBus: EventBus,
  queryPreview: PreviewQuery,
): () => void {
  const panel = document.createElement(
    "modern-command-panel",
  ) as ModernCommandPanel;
  Object.assign(panel, { game, transform, uiState, eventBus, queryPreview });
  panel.style.cssText = "display:block;width:100%;pointer-events:auto";
  const hud = document.querySelector(".hud-controls-surface");
  (hud ?? document.body).append(panel);
  panel.start();
  return () => {
    panel.stop();
    panel.remove();
  };
}
