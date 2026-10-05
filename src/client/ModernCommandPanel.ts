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
import "./components/baseComponents/setting/SettingKeybind";
import { HelpModal } from "./HelpModal";
import { ContextMenuEvent } from "./InputHandler";
import {
  MODERN_KEYBINDS_CHANGED,
  MODERN_KEY_DEFAULTS,
  ModernBranchEvent,
  ModernClearSelectionEvent,
  ModernSelectionEvent,
  ModernTargetEvent,
  modernKeybinds,
  saveModernKeybind,
} from "./ModernInput";
import { modernNuclearNotice } from "./ModernNuclearNotice";
import { Platform } from "./Platform";
import { TransformHandler } from "./TransformHandler";
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
  @state() private keysOpen = false;
  @state() private preview: ModernCommandPreview | null = null;
  @state() private target: TileRef | null = null;
  @state() private portId = "";
  @state() private climate = "temperate";
  @state() private climateOverlay = false;
  @state() private inspectTarget = false;
  @state() private selectedBaseId = "";
  private productionPlacement: "airbase" | null = null;
  private pendingProductionTile: TileRef | null = null;
  private climateCanvas: HTMLCanvasElement | null = null;
  private pendingCommand: {
    command: ModernCommandKind;
    queue: boolean;
  } | null = null;
  private revision = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private selectionBox: ModernSelectionEvent | null = null;
  private stopped = true;
  private pendingStops = new Set<string>();
  private userSettings = new UserSettings();

  createRenderRoot() {
    return this;
  }
  private readonly onBranch = (event: ModernBranchEvent) => {
    this.branch = event.branch;
    this.uiState.modernBranchesUsed = [
      ...new Set([...(this.uiState.modernBranchesUsed ?? []), event.branch]),
    ];
    this.selectedIds = [];
    this.operation = "auto";
    this.clearPreview();
    this.status = translateText("modern_v2.select_units");
  };
  private readonly onClear = () => {
    this.selectedIds = [];
    this.selectionBox = null;
    this.uiState.modernTargeting = false;
    this.clearPreview();
  };
  private readonly onKeys = () => this.requestUpdate();
  private updatePlacement(): void {
    const width = Math.min(window.innerWidth * 0.96, 460);
    const sidebar = document
      .querySelector("game-left-sidebar > aside")
      ?.getBoundingClientRect();
    let top = window.innerWidth < 640 ? 56 : 112;
    if (
      sidebar &&
      sidebar.right > window.innerWidth - width - 8 &&
      sidebar.bottom > top
    )
      top = Math.min(window.innerHeight - 180, sidebar.bottom + 8);
    this.style.top = `${Math.max(8, top)}px`;
    this.style.left = "auto";
    this.style.right = "8px";
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
        new Cell(this.game.x(force.tile), this.game.y(force.tile)),
      );
      return (
        point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
      );
    });
    const nearest = tiny
      ? matches
          .sort((a, b) => {
            const distance = (force: ModernForceState) => {
              const point = this.transform.worldToScreenCoordinates(
                new Cell(this.game.x(force.tile), this.game.y(force.tile)),
              );
              return (point.x - event.endX) ** 2 + (point.y - event.endY) ** 2;
            };
            return distance(a) - distance(b) || a.id.localeCompare(b.id);
          })
          .slice(0, 1)
      : matches;
    this.selectedIds = [
      ...new Set([
        ...(event.additive ? this.selectedIds : []),
        ...nearest.map((force) => force.id),
      ]),
    ].slice(0, 32);
    this.clearPreview();
    this.status = this.selectedIds.length
      ? ""
      : translateText("modern_v2.no_units");
  };
  private readonly onTarget = (event: ModernTargetEvent) => {
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
    if (this.productionPlacement === "airbase") {
      const tile = this.game.ref(cell.x, cell.y);
      const me = this.game.myPlayer();
      const bases = this.systems()?.bases ?? [];
      const valid = Boolean(
        me &&
        this.game.isLand(tile) &&
        !this.game.isImpassable(tile) &&
        this.game.ownerID(tile) === me.smallID() &&
        me.gold() >= BigInt(DEFAULT_MODERN_FORCE_RULES.airbaseCost) &&
        !bases.some((base) => base.tile === tile) &&
        bases.filter((base) => base.playerId === me.id()).length <
          DEFAULT_MODERN_FORCE_RULES.maxBasesPerFaction,
      );
      this.pendingProductionTile = tile;
      this.preview = {
        valid,
        reason: valid ? null : "airbase_requires_owned_land_and_gold",
        path: [tile],
        etaTicks: 0,
        rangeTiles: 0,
        risk: "uncertain",
        climateEfficiencyPermille: 1000,
      };
      this.status = valid
        ? translateText("modern_v2.confirm_airbase", {
            cost: DEFAULT_MODERN_FORCE_RULES.airbaseCost,
            capacity: DEFAULT_MODERN_FORCE_RULES.airbaseCapacity,
          })
        : this.reason(this.preview.reason);
      return;
    }
    void this.prepare(this.game.ref(cell.x, cell.y), event.queue);
  };

  public start(): void {
    this.stop();
    this.stopped = false;
    this.eventBus.on(ModernBranchEvent, this.onBranch);
    this.eventBus.on(ModernClearSelectionEvent, this.onClear);
    this.eventBus.on(ModernSelectionEvent, this.onSelect);
    this.eventBus.on(ModernTargetEvent, this.onTarget);
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
    }
    globalThis.removeEventListener(MODERN_KEYBINDS_CHANGED, this.onKeys);
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
  }
  disconnectedCallback(): void {
    this.stop();
    super.disconnectedCallback();
  }
  private systems() {
    return this.game.modernSystems();
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
    this.target = null;
    this.pendingCommand = null;
    this.productionPlacement = null;
    this.pendingProductionTile = null;
  }
  private async prepare(target: TileRef, queue: boolean): Promise<void> {
    const forces = this.ownedForces().filter((force) =>
      this.selectedIds.includes(force.id),
    );
    if (!forces.length) {
      this.status = translateText("modern_v2.no_units");
      return;
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
    const command =
      this.operation !== "auto"
        ? this.operation
        : this.branch === "air"
          ? enemy
            ? forces[0].kind === "strike"
              ? "strike"
              : "air_superiority"
            : "patrol"
          : enemy
            ? "attack"
            : "move";
    const revision = ++this.revision;
    this.status = translateText("modern_v2.checking_path");
    try {
      const previews = await Promise.all(
        forces.map((force) =>
          this.queryPreview(force.id, target, command, queue),
        ),
      );
      if (this.stopped || revision !== this.revision) return;
      this.preview = previews.find((result) => !result.valid) ?? previews[0];
      if (this.branch === "army" && this.preview.valid) {
        if (this.preview.climateEfficiencyPermille > 1000)
          this.uiState.modernClimatePreviewAdapted = true;
        if (this.preview.climateEfficiencyPermille < 1000)
          this.uiState.modernClimatePreviewHarsh = true;
      }
      this.target = target;
      this.pendingCommand = { command, queue };
      this.status = this.preview.valid
        ? translateText("modern_v2.confirm_preview")
        : this.reason(this.preview.reason);
    } catch {
      if (!this.stopped && revision === this.revision)
        this.status = translateText("modern_v2.preview_unavailable");
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
  private sendModern(event: SendModernIntentEvent): void {
    if (this.canDispatch()) this.eventBus.emit(event);
  }
  private confirm(): void {
    if (!this.canDispatch()) return;
    if (
      this.productionPlacement === "airbase" &&
      this.preview?.valid &&
      this.pendingProductionTile !== null
    ) {
      this.eventBus.emit(
        new SendModernIntentEvent({
          type: "modern_produce",
          branch: "air",
          kind: "airbase",
          tile: this.pendingProductionTile,
          count: 1,
        }),
      );
      this.uiState.modernTargeting = false;
      this.clearPreview();
      this.status = translateText("modern_v2.production_sent");
      return;
    }
    if (!this.preview?.valid || this.target === null || !this.pendingCommand)
      return;
    this.eventBus.emit(
      new SendModernIntentEvent({
        type: "modern_command",
        forceIds: [...this.selectedIds],
        command: this.pendingCommand.command,
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
    this.eventBus.emit(
      new SendModernIntentEvent({
        type: "modern_command",
        forceIds: [...this.selectedIds],
        command,
        target: first.tile,
      }),
    );
    this.clearPreview();
  }
  private produce(
    kind: "army" | "warship" | "fighter" | "strike" | "airbase",
  ): void {
    const me = this.game.myPlayer();
    if (!me) return;
    if (kind === "airbase") {
      this.clearPreview();
      this.productionPlacement = "airbase";
      this.uiState.modernTargeting = true;
      this.status = translateText("modern_v2.place_airbase");
      return;
    }
    if (!this.canDispatch()) return;
    const systems = this.systems();
    const bases =
      systems?.bases.filter(
        (item) => item.playerId === me.id() && item.health > 0,
      ) ?? [];
    const base =
      bases.find((item) => item.id === this.selectedBaseId) ?? bases[0];
    const center = me.nameLocation();
    let tile = center
      ? this.game.ref(Math.round(center.x), Math.round(center.y))
      : base?.tile;
    if (kind === "warship")
      tile =
        me
          .units(UnitType.Port)
          .find((port) => port.isActive() && !port.isUnderConstruction())
          ?.tile() ?? tile;
    this.eventBus.emit(
      new SendModernIntentEvent({
        type: "modern_produce",
        branch: kind === "army" ? "army" : kind === "warship" ? "navy" : "air",
        kind,
        baseId: base?.id,
        tile,
        count: 1,
      }),
    );
    this.status = translateText("modern_v2.production_sent");
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
      for (const port of this.systems()?.ports ?? []) {
        if (
          this.transform.scale < 2 &&
          port.ownerId !== this.game.myPlayer()?.id()
        )
          continue;
        const point = this.transform.worldToScreenCoordinates(
          new Cell(this.game.x(port.tile), this.game.y(port.tile)),
        );
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > innerWidth ||
          point.y > innerHeight
        )
          continue;
        ctx.fillStyle = port.level > 0 ? "#ffeb86" : "#b3b9bd";
        ctx.strokeStyle = "#101820";
        ctx.lineWidth = 3;
        ctx.strokeText("⚓", point.x, point.y);
        ctx.fillText("⚓", point.x, point.y);
        if (this.transform.scale >= 6) {
          ctx.font = "11px sans-serif";
          ctx.strokeText(port.name, point.x, point.y + 12);
          ctx.fillText(port.name, point.x, point.y + 12);
          ctx.font = "bold 12px sans-serif";
        }
        ctx.lineWidth = 2;
      }
      for (const base of this.systems()?.bases ?? []) {
        if (
          this.transform.scale < 2 &&
          base.playerId !== this.game.myPlayer()?.id()
        )
          continue;
        const point = this.transform.worldToScreenCoordinates(
          new Cell(this.game.x(base.tile), this.game.y(base.tile)),
        );
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > innerWidth ||
          point.y > innerHeight ||
          base.health <= 0
        )
          continue;
        ctx.fillStyle = "#b9bcff";
        ctx.strokeStyle = "#101820";
        ctx.beginPath();
        ctx.rect(point.x - 11, point.y - 11, 22, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#101820";
        ctx.fillText("H", point.x, point.y + 4);
      }
      for (const force of this.systems()?.forces ?? []) {
        if (force.phase === "destroyed") continue;
        if (
          this.transform.scale < 2 &&
          force.playerId !== this.game.myPlayer()?.id() &&
          force.phase === "idle"
        )
          continue;
        const point = this.transform.worldToScreenCoordinates(
          new Cell(this.game.x(force.tile), this.game.y(force.tile)),
        );
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > innerWidth ||
          point.y > innerHeight
        )
          continue;
        const own = force.playerId === this.game.myPlayer()?.id();
        const selected = this.selectedIds.includes(force.id);
        ctx.fillStyle = own ? "#a2fff0" : "#ffba9e";
        ctx.strokeStyle = "#101820";
        ctx.beginPath();
        if (force.branch === "air") {
          ctx.moveTo(point.x, point.y - 9);
          ctx.lineTo(point.x + 9, point.y + 7);
          ctx.lineTo(point.x, point.y + 3);
          ctx.lineTo(point.x - 9, point.y + 7);
        } else if (force.branch === "navy") {
          ctx.moveTo(point.x - 8, point.y - 5);
          ctx.lineTo(point.x + 8, point.y - 5);
          ctx.lineTo(point.x + 4, point.y + 6);
          ctx.lineTo(point.x - 4, point.y + 6);
        } else {
          ctx.rect(point.x - 6, point.y - 6, 12, 12);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (selected) {
          ctx.strokeStyle = "#fff799";
          ctx.beginPath();
          ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (selected && force.branch === "air") {
          const base = this.systems()?.bases.find(
            (entry) => entry.id === force.baseId,
          );
          if (base) {
            const center = this.transform.worldToScreenCoordinates(
              new Cell(this.game.x(base.tile), this.game.y(base.tile)),
            );
            ctx.strokeStyle = "#89d8ff99";
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
        if (own && this.transform.scale >= 4) {
          ctx.strokeStyle = "#101820";
          ctx.lineWidth = 3;
          const label = `${translateText(`modern_v2.kind.${force.kind}`)} ${force.branch === "air" ? force.aircraft : renderNumber(force.personnel)}`;
          ctx.strokeText(label, point.x, point.y + 23);
          ctx.fillStyle = "white";
          ctx.fillText(label, point.x, point.y + 23);
          ctx.lineWidth = 2;
        }
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
      if (this.preview?.valid && this.preview.path.length) {
        ctx.strokeStyle = "#fff799";
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        this.preview.path.forEach((tile, index) => {
          const point = this.transform.worldToScreenCoordinates(
            new Cell(this.game.x(tile), this.game.y(tile)),
          );
          if (!index) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (this.preview?.valid && this.preview.transportPath?.length) {
        ctx.strokeStyle = "#89d8ff";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        this.preview.transportPath.forEach((tile, index) => {
          const point = this.transform.worldToScreenCoordinates(
            new Cell(this.game.x(tile), this.game.y(tile)),
          );
          if (!index) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
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
      class="pointer-events-auto text-white rounded-lg bg-gray-900/95 p-2 shadow-lg"
      style="max-width:min(96vw,460px);max-height:47dvh;overflow:auto"
    >
      <div class="flex gap-1 justify-between">
        ${(["army", "navy", "air"] as const).map(
          (branch) =>
            html`<button
              class="p-2 rounded ${this.branch === branch
                ? "bg-blue-700"
                : "bg-gray-700"}"
              aria-pressed=${this.branch === branch}
              @click=${() => this.eventBus.emit(new ModernBranchEvent(branch))}
            >
              ${translateText(`modern_v2.branch.${branch}`)}
              <small
                >${formatKeyForDisplay(
                  keys[`modern${branch[0].toUpperCase()}${branch.slice(1)}`] ??
                    "",
                ) || translateText("education.unbound")}</small
              >
            </button>`,
        )}
        <button
          @click=${() => (this.minimized = !this.minimized)}
          aria-expanded=${!this.minimized}
          aria-label=${translateText("modern_v2.minimize")}
          class="p-2"
        >
          ${this.minimized ? "+" : "−"}
        </button>
        <button
          @click=${() => (this.expanded = !this.expanded)}
          aria-expanded=${this.expanded}
          class="p-2"
        >
          ${this.expanded ? "▴" : "▾"}
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
            class="bg-gray-700 p-1 rounded"
            @click=${() => {
              this.selectedIds = forces.map((force) => force.id).slice(0, 32);
              this.clearPreview();
            }}
          >
            ${translateText("modern_v2.select_all")}
          </button>
          <button
            class="bg-gray-700 p-1 rounded"
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
            class="bg-gray-700 p-1 rounded"
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
                class="bg-gray-700 p-1 rounded"
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
        ${this.preview
          ? html`<p class="text-xs mt-1">
                ${translateText("modern_v2.preview", {
                  seconds: Math.ceil(this.preview.etaTicks / 10),
                  range: this.preview.rangeTiles,
                  risk: translateText(`modern_v2.risk.${this.preview.risk}`),
                  efficiency: Math.round(
                    this.preview.climateEfficiencyPermille / 10,
                  ),
                })}
              </p>
              ${this.preview.armyCombat
                ? html`<p class="text-xs">
                    ${translateText("modern_v2.ground_preview", {
                      attacker: renderNumber(
                        this.preview.armyCombat.attackerLossRaw / 10,
                      ),
                      defender: renderNumber(
                        this.preview.armyCombat.defenderLossRaw / 10,
                      ),
                      defenderClimate: Math.round(
                        this.preview.armyCombat.defenderClimatePermille / 10,
                      ),
                      ratio: Math.round(
                        this.preview.armyCombat.climateRatioPermille / 10,
                      ),
                    })}
                  </p>`
                : nothing}
              ${this.preview.usesTransport
                ? html`<p class="text-xs">
                    ${translateText("modern_v2.transport_preview")}
                  </p>`
                : nothing}
              ${this.pendingCommand?.queue
                ? html`<p class="text-xs">
                    ${translateText("modern_v2.queue_preview")}
                  </p>`
                : nothing}
              <button
                class="bg-blue-700 p-2 mt-1 rounded disabled:opacity-50"
                ?disabled=${!this.preview.valid}
                @click=${this.confirm}
              >
                ${translateText("modern_v2.confirm")}
              </button>
              <button
                class="p-2"
                @click=${() => {
                  this.clearPreview();
                  this.status = "";
                }}
              >
                ${translateText("common.cancel")}
              </button>`
          : nothing}
        <p role="status" class="text-xs text-yellow-200 my-1">${this.status}</p>
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
                        @click=${() => {
                          this.selectedIds = [force.id];
                          this.clearPreview();
                        }}
                      >
                        ${translateText(`modern_v2.kind.${force.kind}`)}
                        ${force.id} · ${force.personnel} ·
                        ${translateText(`modern_v2.phase.${force.phase}`)}
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
              ${this.branch === "air"
                ? html`<select
                    class="bg-gray-800 text-xs mb-1"
                    aria-label=${translateText("modern_v2.base_choice")}
                    .value=${this.selectedBaseId}
                    @change=${(event: Event) =>
                      (this.selectedBaseId = (
                        event.target as HTMLSelectElement
                      ).value)}
                  >
                    ${(systems?.bases ?? [])
                      .filter(
                        (base) => base.playerId === me?.id() && base.health > 0,
                      )
                      .map(
                        (base) =>
                          html`<option
                            value=${base.id}
                            ?selected=${base.id === this.selectedBaseId}
                          >
                            ${base.id} · ${base.capacity} ·
                            ${base.health}/${base.maxHealth}
                          </option>`,
                      )}
                  </select>`
                : nothing}
              <div class="flex gap-1 flex-wrap text-xs">
                ${(this.branch === "army"
                  ? ["army"]
                  : this.branch === "navy"
                    ? ["warship"]
                    : ["fighter", "strike", "airbase"]
                ).map(
                  (kind) =>
                    html`<button
                      class="bg-gray-700 rounded p-1"
                      @click=${() =>
                        this.produce(
                          kind as
                            | "army"
                            | "warship"
                            | "fighter"
                            | "strike"
                            | "airbase",
                        )}
                    >
                      ${translateText(`modern_v2.kind.${kind}`)} ·
                      ${renderNumber(
                        kind === "army"
                          ? 0
                          : (DEFAULT_MODERN_FORCE_RULES[
                              `${kind}Cost` as "fighterCost"
                            ] ?? 0),
                      )}
                    </button>`,
                )}
              </div>
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
                  this.keysOpen = !this.keysOpen;
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
              ${this.keysOpen
                ? html`<p class="text-xs">
                      ${translateText("modern_v2.key_priority")}
                    </p>
                    ${Object.entries(MODERN_KEY_DEFAULTS).map(
                      ([action, defaultKey]) =>
                        html`<setting-keybind
                          .action=${action}
                          .label=${translateText(
                            `modern_v2.branch.${action.replace("modern", "").toLowerCase()}`,
                          )}
                          .defaultKey=${defaultKey}
                          .value=${keys[action] ?? ""}
                          @change=${(
                            event: CustomEvent<{
                              action: keyof typeof MODERN_KEY_DEFAULTS;
                              value: string;
                            }>,
                          ) => {
                            if (
                              !saveModernKeybind(
                                event.detail.action,
                                event.detail.value,
                              )
                            )
                              this.status = translateText(
                                "education.storage_error",
                              );
                          }}
                        ></setting-keybind>`,
                    )}`
                : nothing}
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
  panel.style.cssText =
    "position:fixed;right:8px;top:112px;z-index:31;pointer-events:none";
  document.body.append(panel);
  panel.start();
  return () => {
    panel.stop();
    panel.remove();
  };
}
