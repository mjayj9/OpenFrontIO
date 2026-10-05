import { html, nothing, svg, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../core/game/Game";
import {
  factionsForCountry,
  modernFaction,
  ModernFaction,
  modernFactions,
  modernRegions,
} from "../core/game/ModernRegions";
import { modernCountry, modernWorld } from "../core/game/ModernWorld";
import { MODERN_RULES } from "../core/modern/ModernRules";
import { GameStartInfo, RENDERABLE_NAME_CHARS } from "../core/Schemas";
import { generateID } from "../core/Util";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { requestChapter } from "./education/EducationProgressStore";
import { HostLobbyModal } from "./HostLobbyModal";
import { TutorialChapterID } from "./hud/Tutorial";
import type { LangSelector } from "./LangSelector";
import { JoinLobbyEvent } from "./Main";
import { modernAreaException } from "./ModernRegionDetails";
import { renderNumber, renderTroops, translateText } from "./Utils";

const countryPaths = new Map<number, string>();
for (const [index, start, count] of modernWorld.runs) {
  let pos = start,
    remaining = count;
  let path = countryPaths.get(index) ?? "";
  while (remaining > 0) {
    const x = pos % modernWorld.width,
      y = Math.floor(pos / modernWorld.width),
      width = Math.min(remaining, modernWorld.width - x);
    path += `M${x} ${y}h${width}v1h-${width}z`;
    pos += width;
    remaining -= width;
  }
  countryPaths.set(index, path);
}
const factionPaths = new Map<number, string>();
for (const [index, start, count] of modernRegions.runs) {
  let position = start,
    remaining = count,
    path = factionPaths.get(index) ?? "";
  while (remaining > 0) {
    const x = position % modernRegions.width,
      y = Math.floor(position / modernRegions.width);
    const width = Math.min(remaining, modernRegions.width - x);
    path += `M${x} ${y}h${width}v1h-${width}z`;
    position += width;
    remaining -= width;
  }
  factionPaths.set(index, path);
}
@customElement("modern-world-modal")
export class ModernWorldModal extends BaseModal {
  @state() private countryId = "KOR";
  @state() private factionId = "KOR";
  @state() private rulesVersion: 1 | 2 = 2;
  @state() private initialPopulation = MODERN_RULES.initialPopulation as number;
  @state() private aiWeights = { low: 1, medium: 1, high: 1 };
  @state() private participantSlots = 1;
  @state() private fillEmptySlots = false;
  private trainingLesson:
    | "regions"
    | "population"
    | "commands"
    | "air"
    | "climate"
    | "ports"
    | "nuclear"
    | "ai"
    | undefined;
  @state() private query = "";
  @state() private difficulty = Difficulty.Medium;
  @state() private balance: "balanced" | "asymmetric" = "balanced";
  @state() private victory: "territory" | "capitals" | "timed" | "total" =
    "territory";
  @state() private targetPercent = 60;
  @state() private minutes = 30;
  @state() private protectionSeconds = 30;
  @state() private nukes = false;
  @state() private alliances = true;
  @state() private eliminateCapital = false;
  @state() private aiPercent = 25;
  @state() private seed = 1;
  @state() private showCommandGuide = true;
  protected modalConfig() {
    return { maxWidth: "1200px" };
  }
  protected renderHeaderSlot(): TemplateResult {
    return modalHeader({
      title: translateText("modern.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }
  private name(
    c: (typeof modernWorld.countries)[number] | ModernFaction,
  ): string {
    const language =
      document.querySelector<LangSelector>("lang-selector")?.currentLang;
    return language?.startsWith("ko") ? c.nameKo : c.name;
  }
  private chooseCountry(id: string): void {
    this.countryId = id;
    this.factionId = factionsForCountry(id)[0]?.id ?? id;
  }
  public startModernPractice(
    lesson: NonNullable<ModernWorldModal["trainingLesson"]>,
  ): void {
    requestChapter(`modern_${lesson}` as TutorialChapterID);
    this.rulesVersion = 2;
    // Pakistan has adjacent arid (adapted) and continental (unadapted)
    // ground borders close to its start. Egypt would require a distant
    // amphibious operation to reach a harsh unadapted climate.
    this.chooseCountry(
      lesson === "climate" ? "PAK" : lesson === "ports" ? "PRT" : "KOR",
    );
    this.trainingLesson = lesson;
    this.nukes = lesson === "nuclear";
    this.protectionSeconds = 0;
    this.aiPercent = 100;
    this.minutes = 120;
    this.victory = "timed";
    this.start();
    this.trainingLesson = undefined;
  }
  protected renderBody(): TemplateResult {
    const regions = factionsForCountry(this.countryId);
    const selected =
      this.rulesVersion === 2
        ? modernFaction(
            regions.some((region) => region.id === this.factionId)
              ? this.factionId
              : regions[0].id,
          )
        : modernCountry(this.countryId);
    const list = modernWorld.countries.filter((c) =>
      `${c.name} ${c.nameKo} ${c.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase()),
    );
    return html`<div
      class="p-4 text-white space-y-4 max-h-[80dvh] overflow-auto"
    >
      <p>
        ${translateText(
          this.rulesVersion === 2 ? "modern_v2.scope" : "modern.scope",
          {
            count:
              this.rulesVersion === 2
                ? modernFactions.length
                : modernWorld.countries.length,
            width: modernWorld.width,
            height: modernWorld.height,
          },
        )}
      </p>
      <label
        >${translateText("modern_v2.ruleset")}<select
          class="bg-gray-800 p-2 ml-2"
          .value=${String(this.rulesVersion)}
          @change=${(event: Event) =>
            (this.rulesVersion = Number(
              (event.target as HTMLSelectElement).value,
            ) as 1 | 2)}
        >
          <option value="2" ?selected=${this.rulesVersion === 2}>
            ${translateText("modern_v2.ruleset_new")}
          </option>
          <option value="1" ?selected=${this.rulesVersion === 1}>
            ${translateText("modern_v2.ruleset_legacy")}
          </option>
        </select></label
      >
      <svg
        viewBox="0 0 2000 1000"
        role="img"
        aria-label=${translateText("modern.map_selection")}
        style="width:100%;max-height:40dvh;background:#18384e;aspect-ratio:2/1"
      >
        ${(this.rulesVersion === 2
          ? modernFactions
          : modernWorld.countries
        ).map(
          (c) =>
            svg`<path d=${(this.rulesVersion === 2 ? factionPaths : countryPaths).get(c.index) ?? ""} fill=${c.id === selected.id ? "#fff799" : `hsl(${(c.index * 137) % 360} 55% 58%)`} stroke="#182a35" stroke-width=${c.id === selected.id ? 3 : 0.5} tabindex="0" role="button" aria-label=${this.name(c)} @click=${() => {
              this.countryId =
                "parentCountryId" in c ? c.parentCountryId : c.id;
              this.factionId = c.id;
            }} @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.countryId =
                  "parentCountryId" in c ? c.parentCountryId : c.id;
                this.factionId = c.id;
              }
            }}><title>${this.name(c)}</title></path>`,
        )}
      </svg>
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <input
            class="w-full p-2 rounded bg-gray-800"
            type="search"
            placeholder=${translateText("modern.search")}
            aria-label=${translateText("modern.search")}
            .value=${this.query}
            @input=${(e: Event) =>
              (this.query = (e.target as HTMLInputElement).value)}
          />
          <select
            class="w-full p-2 mt-2 bg-gray-800"
            size="7"
            aria-label=${translateText("modern.country")}
            .value=${this.countryId}
            @change=${(e: Event) =>
              this.chooseCountry((e.target as HTMLSelectElement).value)}
          >
            ${list.map(
              (c) =>
                html`<option value=${c.id} ?selected=${c.id === this.countryId}>
                  ${this.name(c)} (${c.id})
                </option>`,
            )}
          </select>
          ${this.rulesVersion === 2
            ? html`<label class="block mt-2"
                  >${translateText("modern_v2.independent_region")}<select
                    class="w-full p-2 bg-gray-800"
                    aria-label=${translateText("modern_v2.independent_region")}
                    .value=${selected.id}
                    @change=${(event: Event) =>
                      (this.factionId = (
                        event.target as HTMLSelectElement
                      ).value)}
                  >
                    ${regions.map(
                      (region) =>
                        html`<option
                          value=${region.id}
                          ?selected=${region.id === selected.id}
                        >
                          ${this.name(region)} · ${renderNumber(region.areaKm2)}
                          km²
                        </option>`,
                    )}
                  </select></label
                >
                <p class="text-sm mt-1">
                  ${translateText("modern_v2.split_policy")}
                </p>`
            : nothing}
        </div>
        <div class="p-3 rounded bg-gray-800">
          <h3 class="text-xl">
            ${selected.flag
              ? html`<img
                  class="inline h-5"
                  alt=""
                  src=${assetUrl(`flags/${selected.flag}.svg`)}
                />`
              : null}
            ${this.name(selected)}
          </h3>
          <p>
            ${translateText("modern.capital")}: ${selected.capitalName}
            (${selected.capital.join(", ")})
          </p>
          ${"areaKm2" in selected
            ? html`<p>
                  ${translateText("modern_v2.area", {
                    area: renderNumber(selected.areaKm2),
                  })}
                </p>
                <p>
                  ${translateText("modern_v2.adaptation")}:
                  ${selected.adaptedClimates
                    .map((climate) =>
                      translateText(`modern_v2.climate.${climate}`),
                    )
                    .join(", ")}
                </p>
                <p>
                  ${translateText("modern_v2.major_ports")}:
                  ${modernRegions.ports
                    .filter((port) => port.factionId === selected.id)
                    .map((port) => port.name)
                    .join(", ") || translateText("modern_v2.landlocked")}
                </p>
                ${selected.areaException
                  ? html`<div class="text-yellow-200">
                      ${translateText("modern_v2.area_exception")}:
                      ${modernAreaException(selected)}
                      <details>
                        <summary>
                          ${translateText("modern_v2.area_source_details")}
                        </summary>
                        ${selected.areaException.reason} ·
                        ${selected.areaException.correction}
                      </details>
                    </div>`
                  : nothing}
                <p>
                  ${translateText("modern_v2.common_start", {
                    population: renderNumber(this.initialPopulation),
                    gold: renderNumber(
                      this.trainingLesson ? 4000000 : MODERN_RULES.initialGold,
                    ),
                    army: renderNumber(
                      Math.floor(
                        (this.initialPopulation *
                          MODERN_RULES.initialArmyPermille) /
                          1000,
                      ),
                    ),
                  })}
                </p>`
            : nothing}
          <p>
            ${translateText("modern.neighbors")}:
            ${selected.neighbors
              .map((id) =>
                this.name(
                  this.rulesVersion === 2
                    ? modernFaction(id)
                    : modernCountry(id),
                ),
              )
              .join(", ") || translateText("modern.island")}
          </p>
          ${this.rulesVersion === 1
            ? html`<p>
                ${translateText("modern.initial", {
                  tiles: selected.tiles,
                  troops: renderTroops(
                    this.balance === "balanced"
                      ? 80000
                      : 80000 *
                          Math.min(4, 1 + Math.floor(selected.tiles / 12000)),
                  ),
                  gold: renderNumber(
                    this.balance === "balanced"
                      ? 400000
                      : 400000 *
                          Math.min(4, 1 + Math.floor(selected.tiles / 12000)),
                  ),
                })}
              </p>`
            : nothing}
          <p>
            ${translateText(
              "represented" in selected && selected.represented
                ? "modern.small_country"
                : "modern.recommendation",
            )}
          </p>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        ${this.rulesVersion === 1
          ? html`<label
                >${translateText("modern.difficulty")}<select
                  class="block bg-gray-800 p-2 w-full"
                  .value=${this.difficulty}
                  @change=${(e: Event) =>
                    (this.difficulty = (e.target as HTMLSelectElement)
                      .value as Difficulty)}
                >
                  ${Object.values(Difficulty).map(
                    (d) =>
                      html`<option
                        value=${d}
                        ?selected=${d === this.difficulty}
                      >
                        ${translateText(`difficulty.${d.toLowerCase()}`)}
                      </option>`,
                  )}
                </select></label
              >
              <label
                >${translateText("modern.balance")}<select
                  class="block bg-gray-800 p-2 w-full"
                  @change=${(e: Event) =>
                    (this.balance = (e.target as HTMLSelectElement)
                      .value as typeof this.balance)}
                >
                  <option
                    value="balanced"
                    ?selected=${this.balance === "balanced"}
                  >
                    ${translateText("modern.balanced")}
                  </option>
                  <option
                    value="asymmetric"
                    ?selected=${this.balance === "asymmetric"}
                  >
                    ${translateText("modern.asymmetric")}
                  </option>
                </select></label
              >`
          : html`${this.numberInput(
                "modern_v2.initial_population",
                this.initialPopulation,
                100000,
                10000000,
                (value) => (this.initialPopulation = value),
              )}${(["low", "medium", "high"] as const).map((level) =>
                this.numberInput(
                  `modern_v2.ai_weight.${level}`,
                  this.aiWeights[level],
                  0,
                  100,
                  (value) => {
                    this.aiWeights = { ...this.aiWeights, [level]: value };
                  },
                ),
              )}
              <p>${translateText("modern_v2.ai_weights_hint")}</p>`}
        <label
          >${translateText("modern.victory")}<select
            class="block bg-gray-800 p-2 w-full"
            @change=${(e: Event) =>
              (this.victory = (e.target as HTMLSelectElement)
                .value as typeof this.victory)}
          >
            ${["territory", "capitals", "timed", "total"].map(
              (v) =>
                html`<option value=${v} ?selected=${v === this.victory}>
                  ${translateText(`modern.${v}`)}
                </option>`,
            )}
          </select></label
        >
        ${["territory", "capitals"].includes(this.victory)
          ? this.numberInput(
              "modern.target",
              this.targetPercent,
              10,
              100,
              (v) => (this.targetPercent = v),
            )
          : nothing}
        ${this.numberInput(
          "modern.minutes",
          this.minutes,
          1,
          120,
          (v) => (this.minutes = v),
        )}
        ${this.numberInput(
          "modern.protection",
          this.protectionSeconds,
          0,
          600,
          (v) => (this.protectionSeconds = v),
        )}
        ${this.rulesVersion === 1
          ? this.numberInput(
              "modern.ai_percent",
              this.aiPercent,
              0,
              100,
              (v) => (this.aiPercent = v),
            )
          : html`<p>${translateText("modern_v2.ai_all_enhanced")}</p>`}
        ${this.numberInput(
          "modern.seed",
          this.seed,
          0,
          1000000,
          (v) => (this.seed = v),
        )}
        <label
          ><input
            type="checkbox"
            .checked=${this.nukes}
            @change=${(e: Event) =>
              (this.nukes = (e.target as HTMLInputElement).checked)}
          />
          ${translateText("modern.nukes")}</label
        >
        <label
          ><input
            type="checkbox"
            .checked=${this.alliances}
            @change=${(e: Event) =>
              (this.alliances = (e.target as HTMLInputElement).checked)}
          />
          ${translateText("modern.alliances")}</label
        >
        <label
          ><input
            type="checkbox"
            .checked=${this.eliminateCapital}
            @change=${(e: Event) =>
              (this.eliminateCapital = (e.target as HTMLInputElement).checked)}
          />
          ${translateText("modern.capital_elimination")}</label
        >
      </div>
      <p>
        ${translateText(
          this.rulesVersion === 2 ? "modern_v2.fair" : "modern.fair",
        )}
      </p>
      <p class="text-sm text-white/70">
        ${translateText(
          this.rulesVersion === 2
            ? "repair.entry_guide"
            : "repair.legacy_scope",
        )}
      </p>
      ${this.rulesVersion === 2
        ? html`<label class="flex items-center gap-2 text-sm"
              ><input
                type="checkbox"
                .checked=${this.showCommandGuide}
                @change=${(e: Event) =>
                  (this.showCommandGuide = (
                    e.target as HTMLInputElement
                  ).checked)}
              />${translateText("repair.show_guide")}</label
            >
            <button
              class="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 p-2"
              @click=${() => this.startModernPractice("commands")}
            >
              ${translateText("repair.practice")}
            </button>`
        : nothing}
      <button
        class="w-full p-3 rounded bg-blue-600 disabled:opacity-50"
        ?disabled=${this.rulesVersion === 2 &&
        !Object.values(this.aiWeights).some((value) => value > 0)}
        @click=${this.start}
      >
        ${translateText("game_settings.start")}
      </button>
      ${this.rulesVersion === 2
        ? html`<button
              class="w-full p-3 rounded bg-gray-700"
              @click=${() => {
                this.close();
                document
                  .querySelector<HostLobbyModal>("host-lobby-modal")
                  ?.open({ modernPreset: true });
              }}
            >
              ${translateText("modern_v2.invite")}
            </button>
            <details class="text-sm">
              <summary>${translateText("modern_v2.map_sources")}</summary>
              <p>
                Natural Earth · geoBoundaries / OpenStreetMap ·
                <a
                  class="underline"
                  href="https://doi.org/10.1038/s41597-023-02549-6"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Beck et al. (2023)</a
                >
              </p>
              <p>
                <a
                  class="underline"
                  href="https://opendatacommons.org/licenses/odbl/1-0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  >ODbL 1.0</a
                >
                ·
                <a
                  class="underline"
                  href="https://github.com/mjayj9/OpenFrontIO/blob/feature/strategic-ai-modern-world/map-generator/modern-world-v2/LICENSES.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  >${translateText("modern_v2.map_sources")}</a
                >
                ·
                <a
                  class="underline"
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  >CC BY 4.0</a
                >
              </p>
            </details>`
        : nothing}
    </div>`;
  }
  private numberInput(
    key: string,
    value: number,
    min: number,
    max: number,
    set: (v: number) => void,
  ): TemplateResult {
    return html`<label
      >${translateText(key)}<input
        class="block w-full bg-gray-800 p-2"
        type="number"
        .value=${String(value)}
        min=${min}
        max=${max}
        step="1"
        @change=${(e: Event) => {
          const input = e.target as HTMLInputElement;
          const n = Number(input.value);
          if (Number.isFinite(n))
            set(Math.max(min, Math.min(max, Math.round(n))));
        }}
    /></label>`;
  }
  private start = (): void => {
    const candidates = factionsForCountry(this.countryId);
    const country =
        this.rulesVersion === 2
          ? modernFaction(
              candidates.some((faction) => faction.id === this.factionId)
                ? this.factionId
                : candidates[0].id,
            )
          : modernCountry(this.countryId),
      clientID = generateID();
    // Same preset seed creates the same world AI ids/decisions. UI clock is
    // only metadata, never consumed by simulation.
    const gameID = `${this.rulesVersion === 2 ? "MR" : "MW"}${String(this.seed).padStart(6, "0")}`;
    const gameStartInfo: GameStartInfo = {
      gameID,
      lobbyCreatedAt: Date.now(),
      // Country labels may use punctuation excluded by UsernameSchema. Keep
      // human labels readable on the wire; country identity retains the exact
      // name/flag independently of this transport/save username.
      players: [
        {
          clientID,
          username: ("gameName" in country ? country.gameName : country.name)
            .replace(/'/g, "")
            .replace(/&/g, "and")
            .replace(new RegExp(`[^${RENDERABLE_NAME_CHARS}]`, "gu"), "")
            .slice(0, 27),
          clanTag: null,
        },
      ],
      config: {
        gameMap: GameMapType.ModernWorld,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: this.difficulty,
        bots: 0,
        nations: "default",
        donateGold: true,
        donateTroops: true,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        disableAlliances: !this.alliances,
        maxTimerValue: this.minutes,
        disabledUnits: this.nukes
          ? []
          : [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV],
        enhancedAI: {
          tribePercent: 0,
          nationPercent: this.rulesVersion === 2 ? 100 : this.aiPercent,
          personality: "mixed",
          fairResources: true,
          seed: this.seed,
        },
        modernMode: {
          scenario:
            this.rulesVersion === 2 ? "modern-regions-v2" : "modern-world-v1",
          version: this.rulesVersion,
          dataHash:
            this.rulesVersion === 2 ? modernRegions.hash : modernWorld.hash,
          countryId: country.id,
          ...(this.rulesVersion === 2
            ? {
                factionId: country.id,
                initialPopulation: this.initialPopulation,
                aiLevelWeights: this.aiWeights,
                participantSlots: this.participantSlots,
                fillEmptySlots: this.fillEmptySlots,
                trainingLesson: this.trainingLesson,
              }
            : {}),
          balance: this.rulesVersion === 2 ? "balanced" : this.balance,
          victory: this.victory,
          targetPercent: this.targetPercent,
          protectionTicks: this.protectionSeconds * 10,
          capitalElimination: this.eliminateCapital,
        },
      },
    };
    if (
      this.rulesVersion === 2 &&
      !this.trainingLesson &&
      this.showCommandGuide
    )
      requestChapter("modern_commands");
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID,
          gameStartInfo,
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  };
}
