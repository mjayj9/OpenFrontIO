import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  calculateServerTimeOffset,
  getSecondsUntilServerTimestamp,
  renderDuration,
  showToast,
  translateText,
} from "../client/Utils";
import { GameEnv } from "../core/configuration/Config";
import { EventBus } from "../core/EventBus";
import { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  UnitType,
} from "../core/game/Game";
import { modernFactions, modernRegions } from "../core/game/ModernRegions";
import { modernWorld } from "../core/game/ModernWorld";
import { UserSettings } from "../core/game/UserSettings";
import { MODERN_RULES } from "../core/modern/ModernRules";
import {
  ClientInfo,
  GameConfig,
  isValidGameID,
  LOBBY_QUEUE_CUTOFF_MS,
  LobbyInfoEvent,
  TeamCountConfig,
} from "../core/Schemas";
import { createLobby, getUserMe, queueLobby, setLobbyListed } from "./Api";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/ConfirmDialog";
import { CopyButton } from "./components/CopyButton";
import "./components/EnhancedAISettings";
import "./components/GameConfigSettings";
import "./components/InputCard";
import "./components/InsufficientCurrencyDialog";
import "./components/ListLobbyDialog";
import { ListLobbyOptions } from "./components/ListLobbyDialog";
import "./components/LobbyPlayerView";
import "./components/ModernLobbyPicker";
import "./components/PlutoniumIcon";
import "./components/ToggleInputCard";
import { inviteFriendsButton } from "./components/ui/InviteFriendsButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics, InsufficientCurrency } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getRandomMapType,
  getUpdatedDisabledUnits,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseModal {
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private modernMode: GameConfig["modernMode"];
  @state() private enhancedAI: GameConfig["enhancedAI"];
  @state() private modernNukes = false;
  @state() private modernAlliances = true;
  private hydratedLobby = false;
  @state() private teamCount: TeamCountConfig = 2;

  constructor() {
    super();
    this.id = "page-host-lobby";
  }
  @state() private bots: number = 400;
  @state() private spawnImmunity: boolean = false;
  @state() private spawnImmunityDurationMinutes: number | undefined = undefined;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private startDelayValue: number | undefined = 3;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private goldMultiplier: boolean = false;
  @state() private goldMultiplierValue: number | undefined = undefined;
  @state() private startingGold: boolean = false;
  @state() private startingGoldValue: number | undefined = undefined;
  @state() private customAlliances: boolean = false;
  @state() private customAllianceMinutes: number | undefined = undefined;
  @state() private doomsdayClock: boolean = false;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed = "normal";
  @state() private overtime: boolean = false;
  @state() private overtimeStartMinutes: number | undefined = undefined;
  @state() private anonymizeNames: boolean = false;
  @state() private nameReveals: string[] = [];
  @state() private whitelistEnabled: boolean = false;
  @state() private allowedPublicIds: string = "";
  @state() private waterNukes: boolean = false;
  @state() private lobbyId = "";
  @state() private lobbyUrlSuffix = "";
  @state() private clients: ClientInfo[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private hostCheatsEnabled: boolean = false;
  @state() private hostCheatInfiniteGold: boolean = false;
  @state() private hostCheatInfiniteTroops: boolean = false;
  @state() private hostCheatGoldMultiplier: boolean = false;
  @state() private hostCheatGoldMultiplierValue: number | undefined = undefined;
  @state() private hostCheatStartingGold: boolean = false;
  @state() private hostCheatStartingGoldValue: number | undefined = undefined;
  @state() private lobbyCreatorClientID: string = "";
  @state() private lobbyStartAt: number | null = null;
  @state() private serverTimeOffset: number = 0;
  // Whether this user may actually make the lobby public (the API's
  // canCreatePublicLobbies entitlement, or anyone in dev). The toggle itself
  // is always shown.
  @state() private canListPublicly: boolean = false;
  @state() private publiclyListed: boolean = false;
  @state() private showSubscriptionRequired: boolean = false;
  @state() private showListLobbyDialog: boolean = false;
  // Server timestamp when the listed lobby auto-starts (from lobby info).
  @state() private autoStartAt: number | null = null;
  // The host paid to put the listed lobby in the public Special queue.
  @state() private queued: boolean = false;
  // Queue price from cosmetics.json; the Queue button hides without it.
  @state() private queuePriceHard: number | null = null;
  @state() private queueRequestInFlight: boolean = false;
  @state() private showQueueConfirm: boolean = false;
  @state() private insufficientInfo: InsufficientCurrency | null = null;
  private hardBalance = 0;

  @property({ attribute: false }) eventBus: EventBus | null = null;
  // Timers for debouncing slider changes
  private botsUpdateTimer: number | null = null;
  private nationsUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;
  private userSettings = new UserSettings();

  private leaveLobbyOnClose = true;

  // Guards against overlapping listing requests: rapid Public/Private clicks
  // could otherwise be applied out of order by the server, leaving the UI
  // showing the opposite of the real listed state.
  private listingRequestInFlight = false;
  private pendingModernPreset = false;

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    if (!this.lobbyId || lobby.gameID !== this.lobbyId) {
      return;
    }
    if ("serverTime" in lobby && typeof lobby.serverTime === "number") {
      this.serverTimeOffset = calculateServerTimeOffset(lobby.serverTime);
    }
    this.lobbyStartAt = lobby.startsAt ?? null;
    this.lobbyCreatorClientID = lobby.lobbyCreatorClientID ?? "";
    if (lobby.clients) {
      this.clients = lobby.clients;
    }
    if (!this.hydratedLobby && lobby.gameConfig) {
      this.hydratedLobby = true;
      this.modernMode = lobby.gameConfig.modernMode;
      this.enhancedAI = lobby.gameConfig.enhancedAI;
      if (this.modernMode) {
        this.selectedMap = GameMapType.ModernWorld;
        this.compactMap = false;
        this.bots = 0;
        this.nations =
          this.modernMode.scenario === "modern-regions-v2"
            ? modernFactions.length
            : modernWorld.countries.length;
        this.gameMode = GameMode.FFA;
        this.selectedDifficulty = lobby.gameConfig.difficulty;
        this.modernNukes = !lobby.gameConfig.disabledUnits?.includes(
          UnitType.AtomBomb,
        );
        this.modernAlliances = !lobby.gameConfig.disableAlliances;
      }
    }
    // The server can delist on its own (duplicate creator / cap overflow
    // resolved by the master); follow its state unless our own toggle
    // request is mid-flight.
    if (!this.listingRequestInFlight && lobby.listed !== undefined) {
      this.publiclyListed = lobby.listed;
    }
    this.autoStartAt = lobby.autoStartAt ?? null;
    this.queued = lobby.queued ?? false;
    if (this.pendingModernPreset && this.hydratedLobby) {
      this.pendingModernPreset = false;
      this.setModernPreset(true);
    }
  };

  private getRandomString(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  private async buildLobbyUrl(): Promise<string> {
    if (crazyGamesSDK.isOnCrazyGames()) {
      const link = crazyGamesSDK.createInviteLink(this.lobbyId);
      if (link !== null) {
        return link;
      }
    }
    // window.location.origin is deliberate here, NOT ClientEnv.shareOrigin():
    // this URL only ever reaches history.replaceState (updateLobbyHistory), and
    // replaceState to a different origin throws a SecurityError. The link the
    // host actually shares is built separately by copy-button, which does use
    // shareOrigin.
    return `${window.location.origin}${ClientEnv.gamePath(this.lobbyId)}?lobby&s=${encodeURIComponent(this.lobbyUrlSuffix)}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return;
    }
    history.replaceState(null, "", url);
  }

  private updateLobbyHistory(lobbyUrl: string): void {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return;
    }
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    history.replaceState(null, "", lobbyIdHidden ? "/streamer-mode" : lobbyUrl);
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "HostLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  protected renderHeaderSlot() {
    return modalHeader({
      titleContent: html`
        <span
          class="text-white text-xl lg:text-2xl font-bold uppercase tracking-widest break-words hyphens-auto"
        >
          ${translateText("host_modal.title")}
        </span>
        ${this.renderVisibilityToggle()}
      `,
      onBack: () => {
        this.leaveLobbyOnClose = true;
        this.close();
      },
      ariaLabel: translateText("common.back"),
      // Both answer "get my friends into this lobby", so they sit together —
      // the host is the player holding the code and deciding who joins, and
      // was the one surface the invite button originally missed. Paired behind
      // a wrapper only when the invite is present, so a browser renders exactly
      // the markup it did before.
      rightContent: (() => {
        const copy = html`<copy-button
          .lobbyId=${this.lobbyId}
          .lobbySuffix=${this.lobbyUrlSuffix}
          include-lobby-query
        ></copy-button>`;
        // Not until there is a lobby to invite anyone into. createLobby()
        // assigns lobbyId asynchronously and the modal renders before it
        // lands, so without this the button is live during that window with
        // no shadow lobby behind it — the invite would silently no-op. The
        // join modal gets this free from its own !currentLobbyId early return.
        const invite = this.lobbyId ? inviteFriendsButton() : undefined;
        return invite
          ? html`<div class="flex items-center gap-2">${copy}${invite}</div>`
          : copy;
      })(),
    });
  }

  // Private/Public segmented toggle in the header. Shown to everyone;
  // non-subscribers get a subscription-required dialog instead of a listing
  // request (the server re-checks the subscription regardless). Listing is
  // one-way (the server rejects unlisting), so the Private segment goes away
  // once the lobby is listed.
  private renderVisibilityToggle() {
    const segment = (labelKey: string, isPublic: boolean) => html`
      <button
        class="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${this
          .publiclyListed === isPublic
          ? "bg-malibu-blue text-white"
          : "text-white/50 hover:text-white"}"
        @click=${() => this.handleVisibilitySelect(isPublic)}
      >
        ${translateText(labelKey)}
      </button>
    `;
    return html`
      <div
        class="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5 shrink-0"
      >
        ${this.publiclyListed
          ? nothing
          : segment("host_modal.visibility_private", false)}
        ${segment("host_modal.visibility_public", true)}
      </div>
      ${this.renderAutoStartTimer()} ${this.renderQueueButton()}
    `;
  }

  // Listed lobbies only: pay plutonium to put the lobby in the public
  // Special queue, right behind the lobby that's counting down.
  private renderQueueButton() {
    if (!this.publiclyListed) return nothing;
    if (this.queued) {
      return html`<span
        class="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-green-500/15 text-green-400 border border-green-500/30 shrink-0"
        >${translateText("host_modal.queued")}</span
      >`;
    }
    // Gone once the lobby is starting or about to auto-start, so the host
    // can't pay for a spot it starts before reaching (the server refuses
    // too).
    if (
      this.queuePriceHard === null ||
      this.lobbyStartAt !== null ||
      (this.autoStartAt !== null &&
        getSecondsUntilServerTimestamp(
          this.autoStartAt,
          this.serverTimeOffset,
        ) *
          1000 <
          LOBBY_QUEUE_CUTOFF_MS)
    ) {
      return nothing;
    }
    return html`<button
      class="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-all shrink-0 disabled:opacity-50"
      title=${translateText("host_modal.queue_tooltip")}
      ?disabled=${this.queueRequestInFlight}
      @click=${() => (this.showQueueConfirm = true)}
    >
      ${translateText("host_modal.queue")}
      <plutonium-icon .size=${12}></plutonium-icon>
      <span class="tabular-nums">${this.queuePriceHard}</span>
    </button>`;
  }

  private async handleQueue() {
    const price = this.queuePriceHard;
    if (this.queueRequestInFlight || price === null || !this.lobbyId) return;
    this.queueRequestInFlight = true;
    const result = await queueLobby(this.lobbyId);
    this.queueRequestInFlight = false;
    if (result.ok) {
      this.queued = true;
      return;
    }
    if (result.error === "insufficient_balance") {
      this.insufficientInfo = {
        currency: translateText("cosmetics.hard"),
        shortfall: Math.max(1, price - this.hardBalance),
        item: translateText("host_modal.queue_item"),
        canTopUp: true,
      };
      return;
    }
    showToast(translateText("host_modal.queue_failed"), "red", 3000);
  }

  // Countdown until the listed lobby starts automatically (hosts can't sit
  // on a public listing). Hidden once the real start countdown is running —
  // the Start button shows that one.
  private renderAutoStartTimer() {
    if (
      !this.publiclyListed ||
      this.autoStartAt === null ||
      this.lobbyStartAt !== null
    ) {
      return nothing;
    }
    const seconds = getSecondsUntilServerTimestamp(
      this.autoStartAt,
      this.serverTimeOffset,
    );
    return html`<span
      class="text-amber-300 text-xs font-bold tabular-nums shrink-0"
      title=${translateText("host_modal.auto_start_timer")}
      >${renderDuration(seconds)}</span
    >`;
  }

  private handleVisibilitySelect(isPublic: boolean) {
    if (
      this.listingRequestInFlight ||
      isPublic === this.publiclyListed ||
      !this.lobbyId
    ) {
      return;
    }
    if (isPublic && !this.canListPublicly) {
      this.showSubscriptionRequired = true;
      return;
    }
    if (isPublic) {
      // Listing needs the host's start time and player cap first.
      this.showListLobbyDialog = true;
      return;
    }
    void this.handlePublicListingToggle(isPublic);
  }

  protected renderBody() {
    const activePlayers = this.clients.filter((client) => !client.spectator);
    const canFillWithAI =
      this.modernMode?.scenario === "modern-regions-v2" &&
      this.modernMode.fillEmptySlots === true &&
      activePlayers.length >= 1 &&
      (this.modernMode.participantSlots ?? 8) > activePlayers.length;
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? getSecondsUntilServerTimestamp(
            this.lobbyStartAt,
            this.serverTimeOffset,
          )
        : null;
    const statusLabel =
      secondsRemaining === null
        ? this.queued
          ? translateText("host_modal.queued_waiting")
          : this.clients.length === 1 && !canFillWithAI
            ? translateText("host_modal.waiting")
            : translateText("game_settings.start")
        : // A queued lobby's countdown belongs to the public queue; the host
          // can't cancel it.
          translateText(
            this.queued ? "public_lobby.starting_in" : "host_modal.starting_in",
            { time: renderDuration(secondsRemaining) },
          );

    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"game_settings.max_timer"}
        .checked=${this.maxTimer}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("game_settings.max_timer")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<input-card
        .labelKey=${"host_modal.start_delay"}
        .inputId=${"start-delay-value"}
        .inputMin=${0}
        .inputMax=${600}
        .inputStep=${"1"}
        .inputValue=${this.startDelayValue}
        .inputAriaLabel=${translateText("host_modal.start_delay")}
        .inputPlaceholder=${"3"}
        .defaultInputValue=${3}
        .onChange=${this.handleStartDelayValueChanges}
        .onKeyDown=${this.handleStartDelayValueKeyDown}
      ></input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.player_immunity_duration"}
        .checked=${this.spawnImmunity}
        .inputMin=${0}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.spawnImmunityDurationMinutes}
        .inputAriaLabel=${translateText("host_modal.player_immunity_duration")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${5}
        .minValidOnEnable=${0}
        .onToggle=${this.handleSpawnImmunityToggle}
        .onInput=${this.handleSpawnImmunityDurationInput}
        .onKeyDown=${this.handleSpawnImmunityDurationKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.custom_alliances"}
        .checked=${this.customAlliances}
        .inputMin=${0}
        .inputMax=${15}
        .inputStep=${1}
        .inputValue=${this.customAllianceMinutes}
        .inputAriaLabel=${translateText("game_settings.custom_alliances")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${0}
        .minValidOnEnable=${0}
        .zeroLabel=${`(${translateText("public_game_modifier.disable_alliances")})`}
        .onToggle=${this.handleCustomAlliancesToggle}
        .onInput=${this.handleCustomAllianceMinutesInput}
        .onKeyDown=${this.handleCustomAllianceMinutesKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.overtime"}
        .checked=${this.overtime}
        .inputMin=${1}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.overtimeStartMinutes}
        .inputAriaLabel=${translateText("game_settings.overtime")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleOvertimeToggle}
        .onInput=${this.handleOvertimeMinutesInput}
        .onKeyDown=${this.handleOvertimeMinutesKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("game_settings.starting_gold")}
        .inputPlaceholder=${"5"}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
      // A join whitelist and public listing are mutually exclusive (the
      // server rejects both combinations), so the control disappears while
      // the lobby is listed.
      ...(this.publiclyListed
        ? []
        : [
            html`<toggle-input-card
              .labelKey=${"host_modal.player_whitelist"}
              .checked=${this.whitelistEnabled}
              .inputType=${"text"}
              .inputId=${"allowed-public-ids"}
              .inputValue=${this.allowedPublicIds}
              .inputAriaLabel=${translateText("host_modal.player_whitelist")}
              .inputPlaceholder=${translateText(
                "host_modal.player_whitelist_placeholder",
              )}
              .onToggle=${this.handleWhitelistToggle}
              .onChange=${this.handleAllowedPublicIdsChange}
            ></toggle-input-card>`,
          ]),
    ];

    const hostCheatInputCards = [
      html`<toggle-input-card
        .labelKey=${"game_settings.gold_multiplier"}
        .checked=${this.hostCheatGoldMultiplier}
        .inputId=${"host-cheat-gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatGoldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatGoldMultiplierToggle}
        .onChange=${this.handleHostCheatGoldMultiplierValueChanges}
        .onKeyDown=${this.handleHostCheatGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.starting_gold"}
        .checked=${this.hostCheatStartingGold}
        .inputId=${"host-cheat-starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatStartingGoldValue}
        .inputAriaLabel=${translateText("game_settings.starting_gold")}
        .inputPlaceholder=${"5"}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatStartingGoldToggle}
        .onChange=${this.handleHostCheatStartingGoldValueChanges}
        .onKeyDown=${this.handleHostCheatStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="flex flex-col h-full">
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 mr-1 mx-auto w-full max-w-5xl"
        >
          ${this.publiclyListed
            ? html`<div
                class="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-300"
              >
                ${translateText("host_modal.settings_locked_listed")}
              </div>`
            : nothing}
          <!-- Players joined a listed lobby for its advertised settings, so
               they are frozen (the server rejects changes too). -->
          <label class="block p-3 rounded border border-white/20 text-white">
            <input
              type="checkbox"
              .checked=${Boolean(this.modernMode)}
              ?disabled=${this.publiclyListed}
              @change=${(event: Event) =>
                this.setModernPreset(
                  (event.target as HTMLInputElement).checked,
                )}
            />
            ${translateText("modern_lobby.preset")}
          </label>
          ${this.modernMode ? this.renderModernSettings() : nothing}
          <enhanced-ai-settings
            .value=${this.enhancedAI}
            ?inert=${this.publiclyListed}
            @enhanced-ai-change=${(
              event: CustomEvent<GameConfig["enhancedAI"]>,
            ) => {
              this.enhancedAI = event.detail;
              this.clearFairResourceCheats();
              void this.putGameConfig();
            }}
          ></enhanced-ai-settings>
          <game-config-settings
            ?hidden=${Boolean(this.modernMode)}
            class="block ${this.publiclyListed ? "opacity-60" : ""}"
            ?inert=${this.publiclyListed}
            .sectionGapClass=${"space-y-10"}
            .settings=${{
              map: {
                selected: this.selectedMap,
                useRandom: this.useRandomMap,
                randomMapDivider: true,
              },
              difficulty: {
                selected: this.selectedDifficulty,
                disabled: this.nations === 0,
              },
              gameMode: {
                selected: this.gameMode,
              },
              teamCount: {
                selected: this.teamCount,
              },
              options: {
                titleKey: "game_settings.options",
                bots: {
                  value: this.bots,
                  labelKey: "game_settings.bots",
                  disabledKey: "common.disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "game_settings.nations",
                  disabledKey: "common.disabled",
                },
                toggles: [
                  {
                    labelKey: "game_settings.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "game_settings.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "host_modal.donate_gold",
                    checked: this.donateGold,
                  },
                  {
                    labelKey: "host_modal.donate_troops",
                    checked: this.donateTroops,
                  },
                  {
                    labelKey: "game_settings.infinite_gold",
                    checked: this.infiniteGold,
                    hidden: this.enhancedAI?.fairResources,
                  },
                  {
                    labelKey: "game_settings.infinite_troops",
                    checked: this.infiniteTroops,
                    hidden: this.enhancedAI?.fairResources,
                  },
                  {
                    labelKey: "game_settings.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "host_modal.anonymous_players",
                    checked: this.anonymizeNames,
                  },
                  {
                    labelKey: "game_settings.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "game_settings.doomsday_clock",
                    checked: this.doomsdayClock,
                    doomsdayClockSpeed: this.doomsdayClockSpeed,
                  },
                  // Host cheats and public listing are mutually exclusive
                  // (the server rejects both combinations), so the controls
                  // disappear while the lobby is listed.
                  ...(this.publiclyListed
                    ? []
                    : [
                        {
                          labelKey: "host_modal.host_cheats",
                          checked: this.hostCheatsEnabled,
                          hidden: this.enhancedAI?.fairResources,
                        },
                      ]),
                ],
                inputCards,
              },
              hostCheats: {
                titleKey: "host_modal.host_cheats",
                visible:
                  this.hostCheatsEnabled &&
                  !this.publiclyListed &&
                  !this.enhancedAI?.fairResources,
                toggles: [
                  {
                    labelKey: "game_settings.infinite_gold",
                    checked: this.hostCheatInfiniteGold,
                  },
                  {
                    labelKey: "game_settings.infinite_troops",
                    checked: this.hostCheatInfiniteTroops,
                  },
                ],
                inputCards: hostCheatInputCards,
              },
              unitTypes: {
                titleKey: "game_settings.disable_units",
                disabledUnits: this.disabledUnits,
              },
            }}
            @map-selected=${this.handleConfigMapSelected}
            @random-map-selected=${this.handleConfigRandomMapSelected}
            @difficulty-selected=${this.handleConfigDifficultySelected}
            @doomsday-clock-speed-selected=${this
              .handleConfigDoomsdayClockSpeedSelected}
            @game-mode-selected=${this.handleConfigGameModeSelected}
            @team-count-selected=${this.handleConfigTeamCountSelected}
            @bots-changed=${this.handleBotsChange}
            @nations-changed=${this.handleNationsChange}
            @option-toggle-changed=${this.handleConfigOptionToggleChanged}
            @host-cheat-toggle-changed=${this
              .handleConfigHostCheatToggleChanged}
            @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
          ></game-config-settings>

          ${this.modernMode
            ? html`<modern-lobby-picker
                .clients=${this.clients}
                .currentClientID=${this.lobbyCreatorClientID}
                .eventBus=${this.eventBus}
                .mode=${this.modernMode}
              ></modern-lobby-picker>`
            : nothing}

          <lobby-player-view
            class="mt-10"
            .gameMode=${this.gameMode}
            .clients=${this.clients}
            .lobbyCreatorClientID=${this.lobbyCreatorClientID}
            .currentClientID=${this.lobbyCreatorClientID}
            .teamCount=${this.teamCount}
            .nationCount=${this.nations}
            .onKickPlayer=${this.publiclyListed
              ? undefined
              : (clientID: string) => this.kickPlayer(clientID)}
            .onToggleNameReveal=${this.publiclyListed
              ? undefined
              : (clientID: string) => this.toggleNameReveal(clientID)}
            .nameReveals=${this.nameReveals}
            .anonymizeNames=${this.anonymizeNames}
          ></lobby-player-view>
        </div>

        <!-- Player List / footer -->
        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
          <o-button
            data-test-lobby-start
            variant=${secondsRemaining !== null ? "warning" : "primary"}
            width="block"
            size="lg"
            .title=${statusLabel}
            .uppercase=${secondsRemaining === null}
            ?disable=${this.queued ||
            (this.lobbyStartAt === null &&
              ((activePlayers.length < 2 && !canFillWithAI) ||
                Boolean(
                  this.modernMode &&
                  this.clients.some((c) => !c.spectator && !c.countryId),
                )))}
            @click=${this.toggleGameStartTimer}
          ></o-button>
        </div>

        ${this.showListLobbyDialog
          ? html`<list-lobby-dialog
              .currentPlayers=${this.clients.length}
              @cancel=${() => (this.showListLobbyDialog = false)}
              @confirm=${(e: CustomEvent<ListLobbyOptions>) => {
                this.showListLobbyDialog = false;
                void this.handlePublicListingToggle(true, e.detail);
              }}
            ></list-lobby-dialog>`
          : ""}
        ${this.showQueueConfirm && this.queuePriceHard !== null
          ? html`<confirm-dialog
              .heading=${translateText("host_modal.queue_confirm_title")}
              .message=${translateText("host_modal.queue_confirm_body", {
                price: this.queuePriceHard,
              })}
              variant="warning"
              .confirmText=${translateText("host_modal.queue_confirm")}
              @cancel=${() => (this.showQueueConfirm = false)}
              @confirm=${() => {
                this.showQueueConfirm = false;
                void this.handleQueue();
              }}
            ></confirm-dialog>`
          : ""}
        <insufficient-currency-dialog
          .info=${this.insufficientInfo}
          @close=${() => (this.insufficientInfo = null)}
        ></insufficient-currency-dialog>
        ${this.showSubscriptionRequired
          ? html`<confirm-dialog
              .heading=${translateText(
                "host_modal.subscription_required_title",
              )}
              .message=${translateText("host_modal.subscription_required_body")}
              variant="warning"
              .showClose=${true}
              .buttons=${"confirmOnly"}
              .confirmText=${translateText("host_modal.view_subscriptions")}
              @cancel=${() => (this.showSubscriptionRequired = false)}
              @confirm=${() => {
                this.showSubscriptionRequired = false;
                window.location.href = "/#modal=store&tab=subscriptions";
              }}
            ></confirm-dialog>`
          : ""}
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.pendingModernPreset = args?.modernPreset === true;
    // Re-armed here (not in onClose's reset) so that once
    // closeWithoutLeaving() disarms it, no close cascade — e.g. another
    // modal's close() navigating via showPage, which force-closes this one —
    // can re-arm it and disconnect the host mid game-start.
    this.leaveLobbyOnClose = true;
    this.startLobbyUpdates();
    void getUserMe().then((userMe) => {
      // Dev skips the entitlement gate (matching the server) so the
      // listing flow is testable locally.
      this.canListPublicly =
        ClientEnv.env() === GameEnv.Dev ||
        (userMe !== false && userMe.player.canCreatePublicLobbies);
      this.hardBalance =
        userMe === false ? 0 : (userMe.player.currency?.hard ?? 0);
    });
    void fetchCosmetics().then((cosmetics) => {
      this.queuePriceHard = cosmetics?.lobbyQueue?.priceHard ?? null;
    });

    // Attach mode: the server already minted this successor lobby with us as
    // creator (win-screen "New lobby" flow), so bind to the existing id instead
    // of creating another game.
    const existingLobbyId =
      typeof args?.existingLobbyId === "string" ? args.existingLobbyId : null;
    if (existingLobbyId !== null) {
      this.attachToExistingLobby(existingLobbyId).catch(() => {
        // Clear clipboard so the host doesn't accidentally share a dead link,
        // matching the createLobby() failure path below.
        void navigator.clipboard.writeText("").catch(() => {});
      });
      this.loadNationCount();
      return;
    }

    // The server mints the game id, so we don't know it until createLobby
    // resolves. clientID is assigned by the server when we join the lobby.

    // Pass auth token for creator identification (server extracts persistentID from it)
    createLobby()
      .then(async ({ lobby, creatorToken }) => {
        this.lobbyId = lobby.gameID;
        if (!isValidGameID(this.lobbyId)) {
          throw new Error(`Invalid lobby ID format: ${this.lobbyId}`);
        }
        crazyGamesSDK.showInviteButton(this.lobbyId);

        // Now that we have the id, build and copy the share link. If lobby
        // creation fails, the catch below clears the clipboard.
        const url = await this.constructUrl();
        this.updateLobbyHistory(url);
        await this.updateComplete;
        void (this.querySelector("copy-button") as CopyButton)?.handleCopy();
        return creatorToken;
      })
      .then((creatorToken) => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              source: "host",
              creatorToken,
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      })
      .catch(() => {
        // Clear clipboard so the host doesn't accidentally share a dead link
        void navigator.clipboard.writeText("").catch(() => {});
      });
    // BaseModal.firstUpdated() owns modalEl.onClose so the o-modal close path
    // (backdrop / close button) runs confirmBeforeClose(). Don't override it
    // here — doing so would bypass the leave-lobby confirmation.
    this.loadNationCount();
  }

  // Bind the host view to a lobby the server already created (the successor of a
  // finished game). Mirrors the createLobby() success path, minus the creation.
  private async attachToExistingLobby(lobbyId: string): Promise<void> {
    if (!isValidGameID(lobbyId)) {
      throw new Error(`Invalid lobby ID format: ${lobbyId}`);
    }
    this.lobbyId = lobbyId;
    crazyGamesSDK.showInviteButton(this.lobbyId);

    const url = await this.constructUrl();
    this.updateLobbyHistory(url);
    await this.updateComplete;
    void (this.querySelector("copy-button") as CopyButton)?.handleCopy();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.lobbyId,
          source: "host",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private leaveLobby() {
    if (!this.lobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Close as part of the lobby -> game transition (e.g. auto-start of a
  // listed lobby): the host is entering the game, not leaving the lobby, so
  // closing must not disconnect them (the server would tear the lobby down).
  // disarmLeaveOnClose is separate because closing ANY page-modal navigates
  // via showPage, which force-closes the currently visible page — so all
  // lobby modals must be disarmed before any of them is closed.
  public disarmLeaveOnClose() {
    this.leaveLobbyOnClose = false;
  }

  public closeWithoutLeaving() {
    this.disarmLeaveOnClose();
    this.close();
  }

  public confirmBeforeClose(): boolean | Promise<boolean> {
    return this.confirmClose(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    console.log("Closing host lobby modal");
    this.stopLobbyUpdates();
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/"); // Reset URL to base
    }
    crazyGamesSDK.hideInviteButton();

    // Clean up timers and resources
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
      this.nationsUpdateTimer = null;
    }

    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.World;
    this.modernMode = undefined;
    this.enhancedAI = undefined;
    this.modernNukes = false;
    this.modernAlliances = true;
    this.hydratedLobby = false;
    this.selectedDifficulty = Difficulty.Easy;
    this.nations = 0;
    this.defaultNationCount = 0;
    this.gameMode = GameMode.FFA;
    this.teamCount = 2;
    this.bots = 400;
    this.spawnImmunity = false;
    this.spawnImmunityDurationMinutes = undefined;
    this.infiniteGold = false;
    this.donateGold = false;
    this.infiniteTroops = false;
    this.donateTroops = false;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.startDelayValue = 3;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.compactMap = false;
    this.useRandomMap = false;
    this.disabledUnits = [];
    this.lobbyId = "";
    this.clients = [];
    this.lobbyCreatorClientID = "";
    this.goldMultiplier = false;
    this.goldMultiplierValue = undefined;
    this.startingGold = false;
    this.startingGoldValue = undefined;
    this.customAlliances = false;
    this.customAllianceMinutes = undefined;
    this.doomsdayClock = false;
    this.doomsdayClockSpeed = "normal";
    this.overtime = false;
    this.overtimeStartMinutes = undefined;
    this.anonymizeNames = false;
    this.nameReveals = [];
    this.whitelistEnabled = false;
    this.allowedPublicIds = "";
    this.waterNukes = false;
    this.hostCheatsEnabled = false;
    this.hostCheatInfiniteGold = false;
    this.hostCheatInfiniteTroops = false;
    this.hostCheatGoldMultiplier = false;
    this.hostCheatGoldMultiplierValue = undefined;
    this.hostCheatStartingGold = false;
    this.hostCheatStartingGoldValue = undefined;
    this.publiclyListed = false;
    this.showSubscriptionRequired = false;
    this.showListLobbyDialog = false;
    this.queued = false;
    this.queueRequestInFlight = false;
    this.showQueueConfirm = false;
    this.insufficientInfo = null;
    this.autoStartAt = null;
  }

  private async handleSelectRandomMap() {
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    await this.loadNationCount();
    this.putGameConfig();
  }

  private setModernPreset(enabled: boolean): void {
    this.modernMode = enabled
      ? {
          scenario: "modern-regions-v2",
          version: 2,
          dataHash: modernRegions.hash,
          countryId: "KOR",
          factionId: "KOR",
          initialPopulation: MODERN_RULES.initialPopulation,
          aiLevelWeights: { low: 1, medium: 1, high: 1 },
          participantSlots: 8,
          fillEmptySlots: true,
          balance: "balanced",
          victory: "territory",
          targetPercent: 60,
          protectionTicks: 300,
          capitalElimination: false,
        }
      : undefined;
    this.selectedMap = enabled ? GameMapType.ModernWorld : GameMapType.World;
    this.compactMap = false;
    this.gameMode = GameMode.FFA;
    this.bots = enabled ? 0 : 400;
    this.nations = enabled ? modernFactions.length : 0;
    this.defaultNationCount = enabled ? modernFactions.length : 0;
    this.randomSpawn = false;
    if (enabled) {
      this.infiniteGold = this.infiniteTroops = this.instantBuild = false;
      this.donateGold = this.donateTroops = true;
      this.maxTimer = true;
      this.maxTimerValue = 30;
      this.enhancedAI = {
        tribePercent: 0,
        nationPercent: 100,
        personality: "mixed",
        fairResources: true,
        seed: 1,
      };
    }
    void this.loadNationCount().then(() => this.putGameConfig());
  }

  private changeModern(
    patch: Partial<NonNullable<GameConfig["modernMode"]>>,
  ): void {
    this.modernMode = { ...this.modernMode!, ...patch };
    void this.putGameConfig();
  }

  private renderModernSettings() {
    const mode = this.modernMode!;
    return html`<fieldset
      class="p-4 border border-white/20 rounded-xl text-white space-y-3"
      ?inert=${this.publiclyListed}
    >
      <legend>${translateText("modern.title")}</legend>
      <p>
        ${translateText(
          mode.scenario === "modern-regions-v2"
            ? "modern_v2.scope"
            : "modern.scope",
          {
            count:
              mode.scenario === "modern-regions-v2"
                ? modernFactions.length
                : modernWorld.countries.length,
            width: modernWorld.width,
            height: modernWorld.height,
          },
        )}
      </p>
      <p>${translateText("modern_lobby.rules")}</p>
      <div class="grid sm:grid-cols-2 gap-3">
        ${mode.scenario === "modern-regions-v2"
          ? html`<p>${translateText("modern_v2.split_policy")}</p>
              <label
                >${translateText("modern_v2.initial_population")}<input
                  type="number"
                  class="block w-full bg-gray-800 p-2"
                  min="100000"
                  max="10000000"
                  .value=${String(
                    mode.initialPopulation ?? MODERN_RULES.initialPopulation,
                  )}
                  @change=${(event: Event) =>
                    this.changeModern({
                      initialPopulation: Math.max(
                        100000,
                        Math.min(
                          10000000,
                          Math.round(
                            Number((event.target as HTMLInputElement).value) ||
                              MODERN_RULES.initialPopulation,
                          ),
                        ),
                      ),
                    })} /></label
              >${(["low", "medium", "high"] as const).map(
                (level) =>
                  html`<label
                    >${translateText(`modern_v2.ai_weight.${level}`)}<input
                      type="number"
                      class="block w-full bg-gray-800 p-2"
                      min="0"
                      max="100"
                      .value=${String(mode.aiLevelWeights?.[level] ?? 1)}
                      @change=${(event: Event) => {
                        const weights = {
                          low: 1,
                          medium: 1,
                          high: 1,
                          ...mode.aiLevelWeights,
                          [level]: Math.max(
                            0,
                            Math.min(
                              100,
                              Math.round(
                                Number(
                                  (event.target as HTMLInputElement).value,
                                ) || 0,
                              ),
                            ),
                          ),
                        };
                        if (Object.values(weights).some((weight) => weight > 0))
                          this.changeModern({ aiLevelWeights: weights });
                      }}
                  /></label>`,
              )}
              <p>${translateText("modern_v2.ai_weights_hint")}</p>
              <label
                >${translateText("modern_v2.participant_slots")}<input
                  type="number"
                  class="block w-full bg-gray-800 p-2"
                  min="2"
                  max="32"
                  .value=${String(mode.participantSlots ?? 8)}
                  @change=${(event: Event) =>
                    this.changeModern({
                      participantSlots: Math.max(
                        2,
                        Math.min(
                          32,
                          Math.round(
                            Number((event.target as HTMLInputElement).value) ||
                              8,
                          ),
                        ),
                      ),
                    })} /></label
              ><label
                ><input
                  type="checkbox"
                  .checked=${mode.fillEmptySlots ?? true}
                  @change=${(event: Event) =>
                    this.changeModern({
                      fillEmptySlots: (event.target as HTMLInputElement)
                        .checked,
                    })}
                />${translateText("modern_v2.fill_empty_slots")}</label
              >
              <p>${translateText("modern_v2.slot_roles")}</p>`
          : html`<label
                >${translateText("modern.difficulty")}<select
                  class="block bg-gray-800 p-2 w-full"
                  .value=${this.selectedDifficulty}
                  @change=${(event: Event) => {
                    this.selectedDifficulty = (
                      event.target as HTMLSelectElement
                    ).value as Difficulty;
                    void this.putGameConfig();
                  }}
                >
                  ${Object.values(Difficulty).map(
                    (d) =>
                      html`<option
                        value=${d}
                        ?selected=${d === this.selectedDifficulty}
                      >
                        ${translateText(`difficulty.${d.toLowerCase()}`)}
                      </option>`,
                  )}
                </select></label
              >
              <label
                >${translateText("modern.balance")}<select
                  class="block bg-gray-800 p-2 w-full"
                  .value=${mode.balance}
                  @change=${(event: Event) =>
                    this.changeModern({
                      balance: (event.target as HTMLSelectElement)
                        .value as typeof mode.balance,
                    })}
                >
                  ${["balanced", "asymmetric"].map(
                    (b) =>
                      html`<option value=${b} ?selected=${b === mode.balance}>
                        ${translateText(`modern.${b}`)}
                      </option>`,
                  )}
                </select></label
              >`}
        <label
          >${translateText("modern.victory")}<select
            class="block bg-gray-800 p-2 w-full"
            .value=${mode.victory}
            @change=${(event: Event) =>
              this.changeModern({
                victory: (event.target as HTMLSelectElement)
                  .value as typeof mode.victory,
              })}
          >
            ${["territory", "capitals", "timed", "total"].map(
              (v) =>
                html`<option value=${v} ?selected=${v === mode.victory}>
                  ${translateText(`modern.${v}`)}
                </option>`,
            )}
          </select></label
        >
        <label
          >${translateText("modern.target")}<input
            type="number"
            min="10"
            max="100"
            class="block bg-gray-800 p-2 w-full"
            .value=${String(mode.targetPercent)}
            @change=${(event: Event) =>
              this.changeModern({
                targetPercent: Math.min(
                  100,
                  Math.max(
                    10,
                    Math.round(
                      Number((event.target as HTMLInputElement).value) || 60,
                    ),
                  ),
                ),
              })}
        /></label>
        <label
          >${translateText("modern.protection")}<input
            type="number"
            min="0"
            max="600"
            class="block bg-gray-800 p-2 w-full"
            .value=${String(mode.protectionTicks / 10)}
            @change=${(event: Event) =>
              this.changeModern({
                protectionTicks: Math.min(
                  6000,
                  Math.max(
                    0,
                    Math.round(
                      (Number((event.target as HTMLInputElement).value) || 0) *
                        10,
                    ),
                  ),
                ),
              })}
        /></label>
        <label
          >${translateText("game_settings.max_timer")}<input
            type="number"
            min="1"
            max="120"
            class="block bg-gray-800 p-2 w-full"
            .value=${String(this.maxTimerValue ?? 30)}
            @change=${(event: Event) => {
              this.maxTimer = true;
              this.maxTimerValue = Math.min(
                120,
                Math.max(
                  1,
                  Math.round(
                    Number((event.target as HTMLInputElement).value) || 30,
                  ),
                ),
              );
              void this.putGameConfig();
            }}
        /></label>
        <label
          ><input
            type="checkbox"
            .checked=${this.modernNukes}
            @change=${(event: Event) => {
              this.modernNukes = (event.target as HTMLInputElement).checked;
              void this.putGameConfig();
            }}
          />${translateText("modern.nukes")}</label
        >
        <label
          ><input
            type="checkbox"
            .checked=${this.modernAlliances}
            @change=${(event: Event) => {
              this.modernAlliances = (event.target as HTMLInputElement).checked;
              void this.putGameConfig();
            }}
          />${translateText("modern.alliances")}</label
        >
        <label
          ><input
            type="checkbox"
            .checked=${mode.capitalElimination}
            @change=${(event: Event) =>
              this.changeModern({
                capitalElimination: (event.target as HTMLInputElement).checked,
              })}
          />${translateText("modern.capital_elimination")}</label
        >
      </div>
    </fieldset>`;
  }

  private handleConfigRandomMapSelected = () => {
    void this.handleSelectRandomMap();
  };

  private async handleMapSelection(value: GameMapType) {
    if (value === GameMapType.ModernWorld) {
      this.setModernPreset(true);
      return;
    }
    this.selectedMap = value;
    this.useRandomMap = false;
    await this.loadNationCount();
    this.putGameConfig();
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    void this.handleMapSelection(customEvent.detail.map);
  };

  private async handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.putGameConfig();
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    void this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigDoomsdayClockSpeedSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ speed: DoomsdayClockSpeed }>;
    this.doomsdayClockSpeed = customEvent.detail.speed;
    this.putGameConfig();
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    void this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    void this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "game_settings.instant_build":
        this.handleInstantBuildChange(checked);
        break;
      case "game_settings.random_spawn":
        this.handleRandomSpawnChange(checked);
        break;
      case "host_modal.donate_gold":
        this.handleDonateGoldChange(checked);
        break;
      case "host_modal.donate_troops":
        this.handleDonateTroopsChange(checked);
        break;
      case "game_settings.infinite_gold":
        this.handleInfiniteGoldChange(checked);
        break;
      case "game_settings.infinite_troops":
        this.handleInfiniteTroopsChange(checked);
        break;
      case "game_settings.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "host_modal.anonymous_players":
        this.anonymizeNames = checked;
        this.putGameConfig();
        break;
      case "game_settings.water_nukes":
        this.waterNukes = checked;
        this.putGameConfig();
        break;
      case "game_settings.doomsday_clock":
        this.doomsdayClock = checked;
        this.putGameConfig();
        break;
      case "host_modal.host_cheats":
        this.hostCheatsEnabled = checked;
        this.putGameConfig();
        break;
      default:
        break;
    }
  };

  private handleConfigHostCheatToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "game_settings.infinite_gold":
        this.hostCheatInfiniteGold = checked;
        this.putGameConfig();
        break;
      case "game_settings.infinite_troops":
        this.hostCheatInfiniteTroops = checked;
        this.putGameConfig();
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
    this.putGameConfig();
  };

  // Modified to include debouncing
  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    // Update the display value immediately
    this.bots = value;

    // Clear any existing timer
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    // Set a new timer to call putGameConfig after 300ms of inactivity
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  };

  private handleInstantBuildChange = (val: boolean) => {
    this.instantBuild = val;
    this.putGameConfig();
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleOvertimeToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.overtime = checked;
    this.overtimeStartMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleOvertimeMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleOvertimeMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });
    if (value === undefined) {
      return;
    }
    this.overtimeStartMinutes = value;
    this.putGameConfig();
  };

  private handleSpawnImmunityToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.spawnImmunity = checked;
    this.spawnImmunityDurationMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleSpawnImmunityDurationKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleSpawnImmunityDurationInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 120 });
    if (value === undefined) {
      return;
    }
    this.spawnImmunityDurationMinutes = value;
    this.putGameConfig();
  };

  private handleCustomAlliancesToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.customAlliances = checked;
    this.customAllianceMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleCustomAllianceMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleCustomAllianceMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 15 });
    if (value === undefined) {
      return;
    }
    this.customAllianceMinutes = value;
    this.putGameConfig();
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
    this.putGameConfig();
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatGoldMultiplier = checked;
    this.hostCheatGoldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleHostCheatGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.hostCheatGoldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.hostCheatGoldMultiplierValue = value;
    }
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatStartingGold = checked;
    this.hostCheatStartingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleHostCheatStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.hostCheatStartingGoldValue = undefined;
      input.value = "";
    } else {
      this.hostCheatStartingGoldValue = value;
    }
    this.putGameConfig();
  };

  private handleRandomSpawnChange = (val: boolean) => {
    this.randomSpawn = val;
    this.putGameConfig();
  };

  private handleInfiniteGoldChange = (val: boolean) => {
    this.infiniteGold = val;
    this.putGameConfig();
  };

  private handleDonateGoldChange = (val: boolean) => {
    this.donateGold = val;
    this.putGameConfig();
  };

  private handleInfiniteTroopsChange = (val: boolean) => {
    this.infiniteTroops = val;
    this.putGameConfig();
  };

  private handleCompactMapChange = (val: boolean) => {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
    this.putGameConfig();
  };

  private handleDonateTroopsChange = (val: boolean) => {
    this.donateTroops = val;
    this.putGameConfig();
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    if (value === undefined) {
      return;
    }
    this.maxTimerValue = value;
    this.putGameConfig();
  };

  private handleStartDelayValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E", "."]);
  };

  private handleStartDelayValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 0,
      max: 600,
    });

    if (value === undefined) {
      this.startDelayValue = undefined;
      input.value = "";
    } else {
      this.startDelayValue = value;
    }
    this.putGameConfig();
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;

    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
    }
    this.nationsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.nationsUpdateTimer = null;
    }, 300);
  };

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    if (this.gameMode === GameMode.Team) {
      this.donateGold = true;
      this.donateTroops = true;
    } else {
      this.donateGold = false;
      this.donateTroops = false;
    }
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
    this.putGameConfig();
  }

  private handleWhitelistToggle = (checked: boolean) => {
    this.whitelistEnabled = checked;
    this.putGameConfig();
  };

  // Server-authoritative: it re-verifies the subscription and enforces the
  // listing limits, so a failed request reverts the toggle.
  private async handlePublicListingToggle(
    checked: boolean,
    options?: ListLobbyOptions,
  ) {
    this.listingRequestInFlight = true;
    this.publiclyListed = checked;
    const result = await setLobbyListed(this.lobbyId, checked, options);
    if (result.ok) {
      this.publiclyListed = result.listed;
    } else {
      this.publiclyListed = !checked;
      this.showListingError(result.error);
    }
    this.listingRequestInFlight = false;
  }

  private showListingError(serverError?: string) {
    let key = "private_lobby.listing_failed";
    if (serverError === "subscription_required") {
      key = "private_lobby.listing_requires_subscription";
    } else if (serverError === "listing_limit_reached") {
      key = "private_lobby.listing_limit_reached";
    } else if (serverError === "listing_whitelist_enabled") {
      key = "private_lobby.listing_whitelist_enabled";
    } else if (serverError === "listing_host_cheats_enabled") {
      key = "private_lobby.listing_host_cheats_enabled";
    } else if (serverError === "listing_full") {
      key = "private_lobby.listing_full";
    } else if (serverError === "listing_max_players_too_low") {
      key = "private_lobby.listing_max_players_too_low";
    }
    showToast(translateText(key), "red", 3000);
  }

  private handleAllowedPublicIdsChange = (e: Event) => {
    this.allowedPublicIds = (e.target as HTMLInputElement).value;
    this.putGameConfig();
  };

  // Comma/space/newline-separated publicIds, capped at the 200 the schema
  // allows so a large paste can't make the config update fail validation.
  // Undefined when empty (no allowlist).
  private parseAllowedPublicIds(): string[] | undefined {
    const ids = this.allowedPublicIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 200);
    return ids.length > 0 ? ids : undefined;
  }

  private clearFairResourceCheats(): void {
    if (!this.enhancedAI?.fairResources) return;
    this.infiniteGold = false;
    this.infiniteTroops = false;
    this.hostCheatsEnabled = false;
    this.hostCheatInfiniteGold = false;
    this.hostCheatInfiniteTroops = false;
    this.hostCheatGoldMultiplier = false;
    this.hostCheatGoldMultiplierValue = undefined;
    this.hostCheatStartingGold = false;
    this.hostCheatStartingGoldValue = undefined;
  }

  private async putGameConfig() {
    this.clearFairResourceCheats();
    const spawnImmunityTicks = this.spawnImmunityDurationMinutes
      ? this.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    const url = await this.constructUrl();
    this.updateLobbyHistory(url);
    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
            modernMode: this.modernMode,
            enhancedAI: this.enhancedAI ?? {
              tribePercent: 0,
              nationPercent: 0,
              personality: "mixed",
              fairResources: false,
              seed: 1,
            },
            disableAlliances: this.modernMode ? !this.modernAlliances : null,
            gameMap: this.selectedMap,
            gameMapSize: this.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            difficulty: this.selectedDifficulty,
            bots: this.bots,
            infiniteGold: this.infiniteGold,
            donateGold: this.donateGold,
            infiniteTroops: this.infiniteTroops,
            donateTroops: this.donateTroops,
            instantBuild: this.instantBuild,
            randomSpawn: this.randomSpawn,
            gameMode: this.gameMode,
            disabledUnits: this.modernMode
              ? this.modernNukes
                ? []
                : [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV]
              : this.disabledUnits,
            spawnImmunityDuration: this.spawnImmunity
              ? spawnImmunityTicks
              : null,
            playerTeams: this.teamCount,
            nations: sliderToNationsConfig(
              this.nations,
              this.defaultNationCount,
            ),
            maxTimerValue: this.maxTimer === true ? this.maxTimerValue : null,
            startDelay: this.startDelayValue,
            goldMultiplier:
              this.goldMultiplier === true ? this.goldMultiplierValue : null,
            startingGold:
              this.startingGold === true && this.startingGoldValue !== undefined
                ? Math.round(this.startingGoldValue * 1_000_000)
                : null,
            customAllianceDuration: this.customAlliances
              ? (this.customAllianceMinutes ?? 0)
              : null,
            // Send {enabled:false} (not undefined) when off: undefined is dropped
            // by JSON.stringify, so the server's "!== undefined" merge would keep a
            // previously-enabled config and the toggle could never turn off.
            doomsdayClock: this.doomsdayClock
              ? { enabled: true, speed: this.doomsdayClockSpeed }
              : { enabled: false },
            // Same {enabled:false} rule as doomsdayClock above: undefined is
            // dropped by JSON.stringify, so the toggle could never turn off.
            overtime: this.overtime
              ? {
                  enabled: true,
                  startMinutes: this.overtimeStartMinutes ?? 30,
                }
              : { enabled: false },
            anonymizeNames: this.anonymizeNames,
            nameReveals: this.nameReveals,
            allowedPublicIds: this.whitelistEnabled
              ? (this.parseAllowedPublicIds() ?? [])
              : [],
            waterNukes: this.waterNukes ? true : null,
            hostCheats: this.hostCheatsEnabled
              ? {
                  infiniteGold: this.hostCheatInfiniteGold || undefined,
                  infiniteTroops: this.hostCheatInfiniteTroops || undefined,
                  goldMultiplier:
                    this.hostCheatGoldMultiplier === true
                      ? this.hostCheatGoldMultiplierValue
                      : null,
                  startingGold:
                    this.hostCheatStartingGold === true &&
                    this.hostCheatStartingGoldValue !== undefined
                      ? Math.round(this.hostCheatStartingGoldValue * 1_000_000)
                      : null,
                }
              : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleNameReveal(clientID: string) {
    this.nameReveals = this.nameReveals.includes(clientID)
      ? this.nameReveals.filter((c) => c !== clientID)
      : [...this.nameReveals, clientID];
    this.putGameConfig();
  }

  private async toggleGameStartTimer() {
    await this.putGameConfig();
    console.log(
      `Starting private game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]} ${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );

    // If the modal closes as part of starting the game, do not leave the lobby
    this.leaveLobbyOnClose = false;

    this.dispatchEvent(
      new CustomEvent("toggle_game_start_timer", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private kickPlayer(clientID: string) {
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        // A modern preset may have been selected while the manifest loaded.
        const isRegional = this.modernMode?.scenario === "modern-regions-v2";
        const count = isRegional
          ? modernFactions.length
          : manifest.nations.length;
        this.defaultNationCount = count;
        this.nations =
          this.compactMap && !isRegional
            ? Math.max(0, Math.floor(count * 0.25))
            : count;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}
