import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  DESKTOP_TUTORIAL_VIDEO_URL,
  formatKeyForDisplay,
  textDirection,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import {
  ACTIVE_INPUT_CONTEXT_CHANGED,
  activeInputContext,
  inputActionRows,
  InputContext,
  InputMode,
} from "../core/game/KeybindingRegistry";
import {
  INPUT_PROFILE_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import { modalHeader } from "./components/ui/ModalHeader";
import { requestChapter } from "./education/EducationProgressStore";
import {
  EDUCATION_FEATURES,
  searchEducationFeatures,
} from "./education/FeatureRegistry";
import { TUTORIAL_CHAPTERS, TutorialChapterID } from "./hud/Tutorial";
import { Platform } from "./Platform";
import { TroubleshootingModal } from "./TroubleshootingModal";

@customElement("help-modal")
export class HelpModal extends BaseModal {
  protected routerName: string | undefined = "help";
  private gameOverlay = false;

  public open(args?: Record<string, unknown>): void {
    // The menu's inline page is inside the hidden menu during a match. Reuse
    // the original modal shell in the game instead of navigating that page.
    if (
      this.inline &&
      (document.body.classList.contains("in-game") ||
        activeInputContext().context === "replay")
    ) {
      let overlay = document.querySelector<HelpModal>("#game-help-modal");
      if (!overlay) {
        overlay = document.createElement("help-modal") as HelpModal;
        overlay.id = "game-help-modal";
        overlay.gameOverlay = true;
        overlay.routerName = undefined;
        document.body.appendChild(overlay);
      }
      overlay.featureQuery = this.featureQuery;
      overlay.featureChapter = this.featureChapter;
      const target = overlay;
      void target.updateComplete.then(() => {
        if (target.isConnected) target.open(args);
      });
      return;
    }
    super.open(args);
  }

  @state() private keybinds: Record<string, string> = this.getKeybinds();
  @state() private featureQuery = "";
  @state() private featureChapter = "all";
  @state() private shortcutMode: InputMode = activeInputContext().mode;
  @state() private inputContext: InputContext = activeInputContext().context;
  @query("#tutorial-video-iframe") private videoIframe?: HTMLIFrameElement;
  @query("#tutorial-video-player") private videoPlayer?: HTMLVideoElement;

  private getKeybinds(): Record<string, string> {
    return new UserSettings().effectiveKeybinds(
      this.shortcutMode ?? activeInputContext().mode,
      Platform.isMac,
    );
  }
  private readonly refreshInputs = () => {
    this.keybinds = this.getKeybinds();
    this.requestUpdate();
  };
  private readonly refreshContext = () => {
    this.shortcutMode = activeInputContext().mode;
    this.inputContext = activeInputContext().context;
    this.refreshInputs();
  };
  connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener(
      INPUT_PROFILE_CHANGED_EVENT,
      this.refreshInputs,
    );
    globalThis.addEventListener(
      ACTIVE_INPUT_CONTEXT_CHANGED,
      this.refreshContext,
    );
  }
  disconnectedCallback(): void {
    globalThis.removeEventListener(
      INPUT_PROFILE_CHANGED_EVENT,
      this.refreshInputs,
    );
    globalThis.removeEventListener(
      ACTIVE_INPUT_CONTEXT_CHANGED,
      this.refreshContext,
    );
    super.disconnectedCallback();
  }
  public openControls(): void {
    this.openFeature("keybindings");
  }
  private renderInputTable() {
    const rows = inputActionRows(
      this.shortcutMode,
      this.keybinds,
      this.inputContext,
    );
    return html`<section
      class="my-3 rounded-xl border border-white/10 bg-white/5 p-3"
      aria-label=${translateText("input_controls.shortcut_table")}
    >
      <h3>${translateText("input_controls.shortcut_table")}</h3>
      <label
        >${translateText("input_controls.profile")}<select
          class="ms-2 bg-gray-800 rounded p-1"
          .value=${this.shortcutMode}
          @change=${(e: Event) => {
            this.shortcutMode = (e.target as HTMLSelectElement)
              .value as InputMode;
            this.refreshInputs();
          }}
        >
          <option value="classic">
            ${translateText("input_controls.classic")}
          </option>
          <option value="modern">
            ${translateText("input_controls.modern")}
          </option>
        </select></label
      >
      <label class="ms-3"
        >${translateText("input_controls.context")}<select
          class="ms-2 bg-gray-800 rounded p-1"
          .value=${this.inputContext}
          @change=${(e: Event) => {
            this.inputContext = (e.target as HTMLSelectElement)
              .value as InputContext;
            this.requestUpdate();
          }}
        >
          ${["map", "replay", "modal", "text", "keybind"].map(
            (context) =>
              html`<option value=${context}>
                ${translateText(`input_controls.context_${context}`)}
              </option>`,
          )}
        </select></label
      >
      <p class="text-xs my-2">
        ${translateText("input_controls.context_help")}
      </p>
      <table class="w-full text-xs">
        <thead>
          <tr>
            <th>${translateText("help_modal.table_key")}</th>
            <th>${translateText("help_modal.table_action")}</th>
            <th>${translateText("education.description")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) =>
              html`<tr class="border-t border-white/10">
                <td class="py-1" dir="ltr">
                  ${row.binding
                    ? this.renderKey(row.binding)
                    : translateText("input_controls.unassigned")}
                </td>
                <td>${translateText(row.labelKey)}</td>
                <td>
                  ${translateText(row.descriptionKey, {
                    amount: new UserSettings().attackRatioIncrement(),
                  })}
                </td>
              </tr>`,
          )}
          ${rows.length === 0
            ? html`<tr>
                <td colspan="3">
                  ${translateText("input_controls.no_game_keys")}
                </td>
              </tr>`
            : ""}
        </tbody>
      </table>
    </section>`;
  }

  private getKeyLabel(code: string): string {
    if (!code) return "";
    if (code.includes("+"))
      return code
        .split("+")
        .map((part) => this.getKeyLabel(part))
        .join(" + ");

    const specialLabels: Record<string, string> = {
      ShiftLeft: "⇧ Shift",
      ShiftRight: "⇧ Shift",
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl",
      AltLeft: "Alt",
      AltRight: "Alt",
      MetaLeft: "⌘",
      MetaRight: "⌘",
      Space: "Space",
      Escape: "Esc",
      Enter: "↵ Return",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      MouseLeft: translateText("input_controls.mouse_left"),
      MouseRight: translateText("input_controls.mouse_right"),
      MouseMiddle: translateText("input_controls.mouse_middle"),
      MouseDrag: translateText("input_controls.mouse_drag"),
      Tap: translateText("input_controls.touch_tap"),
      Pinch: translateText("input_controls.touch_pinch"),
      TwoFingerDrag: translateText("input_controls.two_finger"),
      LongPress: translateText("input_controls.long_press"),
      TargetTap: translateText("input_controls.target_tap"),
      Wheel: translateText("input_controls.wheel"),
      TouchTap: translateText("input_controls.touch_tap"),
      TouchDrag: translateText("input_controls.touch_drag"),
      TouchPinch: translateText("input_controls.touch_pinch"),
    };

    if (specialLabels[code]) return specialLabels[code];
    return formatKeyForDisplay(code);
  }

  private renderKey(code: string) {
    const label = this.getKeyLabel(code);
    // Key names stay left-to-right even inside RTL locales so the badges
    // (and combos like "Shift + click") never scramble.
    return html`<span
      dir="ltr"
      class="inline-block min-w-[32px] text-center px-2 py-1 rounded bg-[#2a2a2a] border-b-2 border-[#1a1a1a] text-white font-mono text-xs font-bold mx-0.5"
      >${label}</span
    >`;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("main.help"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    return html`
      <div
        dir=${textDirection()}
        class="prose prose-invert prose-sm max-w-none px-6 py-3
          [&_a]:text-blue-400 [&_a:hover]:text-blue-300 transition-colors
          [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
          [&_ul]:ps-5 [&_ul]:list-disc [&_ul]:space-y-1
          [&_li]:text-gray-300 [&_li]:leading-relaxed
          [&_p]:text-gray-300 [&_p]:mb-3 [&_strong]:text-white [&_strong]:font-bold
          [&_p]:[unicode-bidi:plaintext] [&_li]:[unicode-bidi:plaintext]
          [&_td:nth-child(2)]:[unicode-bidi:plaintext]
          [&_td:nth-child(3)]:[unicode-bidi:plaintext]"
      >
          ${this.renderFeatureReference()}
          <!-- In-game tutorial: starts a default solo game with the guide on -->
          <section
            class="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/5 rounded-xl border border-white/10 px-5 py-4 mb-8"
          >
            <div>
              <h3 class="!mt-0 !mb-1">
                ${translateText("help_modal.in_game_tutorial")}
              </h3>
              <p class="!mb-0 text-sm">
                ${translateText("help_modal.in_game_tutorial_desc")}
              </p>
            </div>
            <button
              class="shrink-0 hover:bg-white/5 px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
              @click=${() => this.startChapter("basic")}
            >
              ${translateText("help_modal.in_game_tutorial_start")}
            </button>
          </section>

          <!-- Video Tutorial Section -->
          <div class="flex items-center gap-3 mb-3">
            <div class="text-blue-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
            <h3
              class="text-xl font-bold uppercase tracking-widest text-white/90"
            >
              ${translateText("help_modal.video_tutorial")}
            </h3>
            <div
              class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
            ></div>
          </div>
          <section
            class="bg-white/5 rounded-xl border border-white/10 overflow-hidden mb-8"
          >
            <div class="relative w-full h-0 pb-[56.25%]">
              ${
                Platform.isElectron
                  ? html`<video
                      id="tutorial-video-player"
                      class="absolute top-0 left-0 w-full h-full"
                      src="${DESKTOP_TUTORIAL_VIDEO_URL}"
                      title="${translateText(
                        "help_modal.video_tutorial_title",
                      )}"
                      controls
                      preload="metadata"
                    ></video>`
                  : html`<iframe
                      id="tutorial-video-iframe"
                      class="absolute top-0 left-0 w-full h-full"
                      src="${this.isModalOpen ? TUTORIAL_VIDEO_URL : ""}"
                      title="${translateText(
                        "help_modal.video_tutorial_title",
                      )}"
                      frameborder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowfullscreen
                    ></iframe>`
              }
            </div>
          </section>

          <!-- Troubleshooting Section -->
          <div class="flex items-center gap-3 mb-3">
            <div class="text-blue-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 20 L12 0 L22 20 L2 20"></path>
                <line x1="12" y1="8" x2="12" y2="14"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
            <h3
              class="text-xl font-bold uppercase tracking-widest text-white/90"
            >
              ${translateText("main.troubleshooting")}
            </h3>
            <div
              class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
            ></div>
          </div>
          <section>
            <div class="w-full flex flex-col items-center">
              <p class="mb-6 text-white/70 text-sm">
                ${translateText("help_modal.troubleshooting_desc")}
              </p>
              <button
                id="troubleshooting-button"
                class="hover:bg-white/5 px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
                data-page="page-troubleshooting"
                @click="${this.openTroubleshooting}"
                data-i18n="main.go_to_troubleshooting"
              >
                <span
                  class="relative z-10 text-2xl"
                  data-i18n="main.go_to_troubleshooting"
                ></span>
              </button>
            </div>
          </section>
          <!-- Hotkeys Section -->
          <div class="flex items-center gap-3 mb-3">
            <div class="text-blue-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-blue-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                <path d="M6 8h.001"></path>
                <path d="M10 8h.001"></path>
                <path d="M14 8h.001"></path>
                <path d="M18 8h.001"></path>
                <path d="M6 12h.001"></path>
                <path d="M10 12h.001"></path>
                <path d="M14 12h.001"></path>
                <path d="M18 12h.001"></path>
                <path d="M6 16h12"></path>
              </svg>
            </div>
            <h3
              class="text-xl font-bold uppercase tracking-widest text-white/90"
            >
              ${translateText("help_modal.hotkeys")}
            </h3>
            <div
              class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
            ></div>
          </div>
          ${this.renderInputTable()}

          <!-- UI Interface Section -->
          <section class="mb-8 mt-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.ui_section")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 gap-6">
              <!-- Leaderboard -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_leaderboard")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/leaderboard2.webp")}
                    alt="Leaderboard"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_leaderboard_desc")}</p>
                </div>
              </div>

              <!-- Control Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_control")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/controlPanel.webp")}
                    alt="Control Panel"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_control_desc")}
                  </p>
                  <ul class="space-y-2 list-disc ps-4 text-white/60">
                    <li>${translateText("help_modal.ui_gold")}</li>
                    <li>${translateText("help_modal.ui_attack_ratio")}</li>
                  </ul>
                </div>
              </div>

              <!-- Events Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_events")}</span
                  >
                  <div class="flex flex-col gap-2">
                    <img
                      src=${assetUrl("images/helpModal/eventsPanel.webp")}
                      alt="Events"
                      class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                      loading="lazy"
                    />
                    <img
                      src=${assetUrl("images/helpModal/eventsPanelAttack.webp")}
                      alt="Events Attack"
                      class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_events_desc")}
                  </p>
                  <ul class="space-y-2 list-disc ps-4 text-white/60">
                    <li>${translateText("help_modal.ui_events_alliance")}</li>
                    <li>${translateText("help_modal.ui_events_attack")}</li>
                    <li>${translateText("help_modal.ui_events_quickchat")}</li>
                  </ul>
                </div>
              </div>

              <!-- Options -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_options")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/options2.webp")}
                    alt="Options"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_options_desc")}
                  </p>
                  <ul class="space-y-2 list-disc ps-4 text-white/60">
                    <li>${translateText("help_modal.option_timer")}</li>
                    <li>${translateText("help_modal.option_speed")}</li>
                    <li>${translateText("help_modal.option_pause")}</li>
                    <li>${translateText("help_modal.option_settings")}</li>
                    <li>${translateText("help_modal.option_exit")}</li>
                  </ul>
                </div>
              </div>

              <!-- Player Overlay -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_playeroverlay")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/playerInfoOverlay.webp")}
                    alt="Player Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_playeroverlay_desc")}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- Radial Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.radial_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div
              class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
            >
              <div class="flex flex-col gap-4 shrink-0">
                <img
                  src=${assetUrl("images/helpModal/radialMenu2.webp")}
                  alt="Radial Menu"
                  class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                  loading="lazy"
                />
                <img
                  src=${assetUrl("images/helpModal/radialMenuAlly.webp")}
                  alt="Radial Menu Ally"
                  class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                  loading="lazy"
                />
              </div>
              <div class="text-white/70 text-sm">
                <p class="mb-4 leading-relaxed">
                  ${translateText("help_modal.radial_desc")}
                </p>
                <ul class="space-y-3">
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/BuildIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_build")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/InfoIcon.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_info")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/BoatIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_boat")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/AllianceIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.info_alliance")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/TraitorIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.ally_betray")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/DonateTroopIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span
                      >${translateText("help_modal.radial_donate_troops")}</span
                    >
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/DonateGoldIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span
                      >${translateText("help_modal.radial_donate_gold")}</span
                    >
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <!-- Info/Ally Panels Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.info_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Enemy Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_enemy_panel")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/infoMenu2.webp")}
                    alt="Enemy Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[240px]"
                    loading="lazy"
                  />
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_enemy_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/ChatIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_chat")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/TargetIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_target")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/AllianceIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_alliance")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/EmojiIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_emoji")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/StopIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                        loading="lazy"
                      />
                      <span>${translateText("help_modal.info_trade")}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Ally Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_ally_panel")}</span
                  >
                  <img
                    src=${assetUrl("images/helpModal/infoMenu2Ally.webp")}
                    alt="Ally Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[240px]"
                    loading="lazy"
                  />
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_ally_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/TraitorIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.ally_betray")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/DonateTroopIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.ally_donate")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/DonateGoldIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span
                        >${translateText("help_modal.ally_donate_gold")}</span
                      >
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <!-- Build Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.build_menu_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-4 text-white/70 text-sm">
              ${translateText("help_modal.build_menu_desc")}
            </p>

            <div class="overflow-hidden rounded-xl border border-white/10">
              <table class="w-full border-collapse">
                <thead class="bg-white/10">
                  <tr>
                    <th
                      class="py-3 ps-4 text-start text-xs font-bold uppercase tracking-wider text-blue-300 w-[20%]"
                    >
                      ${translateText("help_modal.build_name")}
                    </th>
                    <th
                      class="py-3 text-start text-xs font-bold uppercase tracking-wider text-blue-300 w-[8%]"
                    >
                      ${translateText("help_modal.build_icon")}
                    </th>
                    <th
                      class="py-3 text-start text-xs font-bold uppercase tracking-wider text-blue-300"
                    >
                      ${translateText("help_modal.build_desc")}
                    </th>
                  </tr>
                </thead>
                <tbody class="text-white/80">
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.city")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/CityIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_city_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.defense_post")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/ShieldIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_defense_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.port")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/PortIcon.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_port_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.factory")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/FactoryIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_factory_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.warship")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/BattleshipIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_warship_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.missile_silo")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MissileSiloIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_silo_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.sam_launcher")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/SamLauncherIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_sam_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.atom_bomb")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/NukeIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_atom_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.hydrogen_bomb")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MushroomCloudIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_hydrogen_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 ps-4 border-b border-white/5 font-medium">
                      ${translateText("unit_type.mirv")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MIRVIcon.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_mirv_desc")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Player Icons Section -->
          <section class="mb-4">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.player_icons")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-6 text-white/70 text-sm">
              ${translateText("help_modal.icon_desc")}
            </p>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
              <!-- Crown -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <img
                  src=${assetUrl("images/helpModal/crown.webp")}
                  alt="Rank 1"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_crown")}
                </span>
              </div>

              <!-- Traitor -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <img
                  src=${assetUrl("images/helpModal/traitor2.webp")}
                  alt="Traitor"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_traitor")}
                </span>
              </div>

              <!-- Ally -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <img
                  src=${assetUrl("images/helpModal/ally2.webp")}
                  alt="Ally"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_ally")}
                </span>
              </div>

              <!-- Embargo -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <img
                  src=${assetUrl("images/helpModal/embargo.webp")}
                  alt="Embargo"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_embargo")}
                </span>
              </div>

              <!-- Alliance Request -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <img
                  src=${assetUrl("images/helpModal/allianceRequest.webp")}
                  alt="Request"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_request")}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  public openFeature(featureId: string): void {
    if (!EDUCATION_FEATURES.some((feature) => feature.featureId === featureId))
      return;
    this.featureQuery = featureId;
    this.featureChapter = "all";
    this.open();
  }

  private startChapter(chapter: TutorialChapterID): void {
    if (this.isOpen()) this.close();
    requestChapter(chapter);
    document.dispatchEvent(
      new CustomEvent("start-tutorial", { detail: { chapter } }),
    );
  }

  private renderFeatureReference() {
    const features = searchEducationFeatures(
      this.featureQuery,
      translateText,
      this.featureChapter,
    );
    return html`<section
      class="mb-8 rounded-xl bg-white/5 border border-white/10 p-4"
      aria-label=${translateText("education.reference")}
    >
      <h3 class="!mt-0">${translateText("education.reference")}</h3>
      <p>${translateText("education.reference_intro")}</p>
      <div class="flex flex-wrap gap-2 mb-3">
        <input
          class="min-w-0 flex-1 rounded bg-black/30 border border-white/20 p-2 text-white"
          type="search"
          .value=${this.featureQuery}
          placeholder=${translateText("education.search")}
          aria-label=${translateText("education.search")}
          @input=${(event: Event) =>
            (this.featureQuery = (event.target as HTMLInputElement).value)}
        />
        <select
          class="rounded bg-gray-800 border border-white/20 p-2 text-white"
          aria-label=${translateText("education.chapter")}
          .value=${this.featureChapter}
          @change=${(event: Event) =>
            (this.featureChapter = (event.target as HTMLSelectElement).value)}
        >
          <option value="all">
            ${translateText("education.all_features")}
          </option>
          ${TUTORIAL_CHAPTERS.filter((chapter) => chapter.id !== "full").map(
            (chapter) =>
              html`<option value=${chapter.id}>
                ${translateText(`education.chapters.${chapter.id}`)}
              </option>`,
          )}
          <option value="reference">
            ${translateText("education.reference")}
          </option>
          <option value="modern">
            ${translateText("education.chapters.modern")}
          </option>
        </select>
      </div>
      <div class="flex flex-wrap gap-2 mb-3">
        ${TUTORIAL_CHAPTERS.map(
          (chapter) =>
            html`<button
              class="rounded border border-blue-400/30 px-2 py-1 text-xs text-blue-200"
              @click=${() => this.startChapter(chapter.id)}
            >
              ${translateText(`education.chapters.${chapter.id}`)}
            </button>`,
        )}
      </div>
      <p class="text-xs">
        ${translateText("education.feature_count", {
          count: features.length,
          total: EDUCATION_FEATURES.length,
        })}
      </p>
      ${features.length === 0
        ? html`<p role="status">${translateText("education.no_results")}</p>`
        : features.map(
            (feature) =>
              html`<details
                id=${feature.helpAnchor}
                class="border-t border-white/10 py-2"
                ?open=${this.featureQuery === feature.featureId}
              >
                <summary class="cursor-pointer font-semibold text-white">
                  ${translateText(
                    `education.features.${feature.featureId}.title`,
                  )}
                  <span class="text-xs text-gray-400"
                    >${feature.featureId}</span
                  >
                </summary>
                <p class="mt-2">
                  ${translateText(
                    `education.features.${feature.featureId}.description`,
                  )}
                </p>
                <dl
                  class="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-300"
                >
                  <dt>${translateText("education.prerequisites")}</dt>
                  <dd>
                    ${translateText(
                      `education.features.${feature.featureId}.prerequisites`,
                    )}
                  </dd>
                  <dt>${translateText("education.exercise")}</dt>
                  <dd>
                    ${translateText(
                      `education.features.${feature.featureId}.exercise`,
                    )}
                  </dd>
                  <dt>${translateText("education.completion")}</dt>
                  <dd>
                    ${translateText(
                      `education.features.${feature.featureId}.completion`,
                    )}
                  </dd>
                  <dt>${translateText("education.modes")}</dt>
                  <dd>
                    ${feature.modes
                      .map((mode) =>
                        translateText(`education.modes_list.${mode}`),
                      )
                      .join(", ")}
                  </dd>
                </dl>
                ${feature.featureId === "keybindings"
                  ? this.renderInputTable()
                  : ""}
                ${feature.kind === "practice"
                  ? html`<button
                      class="mt-2 text-blue-300 underline"
                      @click=${() =>
                        this.startChapter(feature.chapter as TutorialChapterID)}
                    >
                      ${translateText("education.practice_chapter")}
                    </button>`
                  : ""}
              </details>`,
          )}
    </section>`;
  }

  openTroubleshooting() {
    const troubleshootingModal = document.querySelector(
      "troubleshooting-modal",
    ) as TroubleshootingModal;
    if (
      !troubleshootingModal ||
      !(troubleshootingModal instanceof TroubleshootingModal)
    ) {
      console.warn("Troubleshooting modal element not found");
      return;
    }
    troubleshootingModal.open();
  }

  protected onOpen(): void {
    this.shortcutMode = activeInputContext().mode;
    this.inputContext = activeInputContext().context;
    this.keybinds = this.getKeybinds();
    // Restore the video src when modal opens
    if (this.videoIframe) {
      this.videoIframe.src = TUTORIAL_VIDEO_URL;
    }
  }

  protected onClose(): void {
    // Clear the iframe src to stop video playback
    if (this.videoIframe) {
      this.videoIframe.src = "";
    }
    // The desktop <video> keeps its src -- the file is local, so unlike the
    // YouTube iframe there is nothing to unload; pausing is enough.
    this.videoPlayer?.pause();
    if (this.gameOverlay) queueMicrotask(() => this.remove());
  }
}
