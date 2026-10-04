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
import { modernCountry, modernWorld } from "../core/game/ModernWorld";
import { GameStartInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import type { LangSelector } from "./LangSelector";
import { JoinLobbyEvent } from "./Main";
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
@customElement("modern-world-modal")
export class ModernWorldModal extends BaseModal {
  @state() private countryId = "KOR";
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
  private name(c: (typeof modernWorld.countries)[number]): string {
    const language =
      document.querySelector<LangSelector>("lang-selector")?.currentLang;
    return language?.startsWith("ko") ? c.nameKo : c.name;
  }
  protected renderBody(): TemplateResult {
    const selected = modernCountry(this.countryId);
    const list = modernWorld.countries.filter((c) =>
      `${c.name} ${c.nameKo} ${c.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase()),
    );
    return html`<div
      class="p-4 text-white space-y-4 max-h-[80dvh] overflow-auto"
    >
      <p>
        ${translateText("modern.scope", {
          count: modernWorld.countries.length,
          width: modernWorld.width,
          height: modernWorld.height,
        })}
      </p>
      <svg
        viewBox="0 0 2000 1000"
        role="img"
        aria-label=${translateText("modern.map_selection")}
        style="width:100%;max-height:40dvh;background:#18384e;aspect-ratio:2/1"
      >
        ${modernWorld.countries.map(
          (c) =>
            svg`<path d=${countryPaths.get(c.index) ?? ""} fill=${c.id === this.countryId ? "#fff799" : `hsl(${(c.index * 137) % 360} 55% 58%)`} stroke="#182a35" stroke-width=${c.id === this.countryId ? 3 : 0.5} tabindex="0" role="button" aria-label=${this.name(c)} @click=${() => (this.countryId = c.id)} @keydown=${(
              e: KeyboardEvent,
            ) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.countryId = c.id;
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
              (this.countryId = (e.target as HTMLSelectElement).value)}
          >
            ${list.map(
              (c) =>
                html`<option value=${c.id} ?selected=${c.id === this.countryId}>
                  ${this.name(c)} (${c.id})
                </option>`,
            )}
          </select>
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
          <p>
            ${translateText("modern.neighbors")}:
            ${selected.neighbors
              .map((id) => this.name(modernCountry(id)))
              .join(", ") || translateText("modern.island")}
          </p>
          <p>
            ${translateText("modern.initial", {
              tiles: selected.tiles,
              troops: renderTroops(
                this.balance === "balanced"
                  ? 80000
                  : 80000 * Math.min(4, 1 + Math.floor(selected.tiles / 12000)),
              ),
              gold: renderNumber(
                this.balance === "balanced"
                  ? 400000
                  : 400000 *
                      Math.min(4, 1 + Math.floor(selected.tiles / 12000)),
              ),
            })}
          </p>
          <p>
            ${translateText(
              selected.represented
                ? "modern.small_country"
                : "modern.recommendation",
            )}
          </p>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label
          >${translateText("modern.difficulty")}<select
            class="block bg-gray-800 p-2 w-full"
            .value=${this.difficulty}
            @change=${(e: Event) =>
              (this.difficulty = (e.target as HTMLSelectElement)
                .value as Difficulty)}
          >
            ${Object.values(Difficulty).map(
              (d) =>
                html`<option value=${d} ?selected=${d === this.difficulty}>
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
            <option value="balanced">
              ${translateText("modern.balanced")}
            </option>
            <option value="asymmetric">
              ${translateText("modern.asymmetric")}
            </option>
          </select></label
        >
        <label
          >${translateText("modern.victory")}<select
            class="block bg-gray-800 p-2 w-full"
            @change=${(e: Event) =>
              (this.victory = (e.target as HTMLSelectElement)
                .value as typeof this.victory)}
          >
            ${["territory", "capitals", "timed", "total"].map(
              (v) =>
                html`<option value=${v}>
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
        ${this.numberInput(
          "modern.ai_percent",
          this.aiPercent,
          0,
          100,
          (v) => (this.aiPercent = v),
        )}
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
      <p>${translateText("modern.fair")}</p>
      <button class="w-full p-3 rounded bg-blue-600" @click=${this.start}>
        ${translateText("game_settings.start")}
      </button>
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
    const country = modernCountry(this.countryId),
      clientID = generateID();
    // Same preset seed creates the same world AI ids/decisions. UI clock is
    // only metadata, never consumed by simulation.
    const gameID = `MW${String(this.seed).padStart(6, "0")}`;
    const gameStartInfo: GameStartInfo = {
      gameID,
      lobbyCreatedAt: Date.now(),
      // Country labels may use punctuation excluded by UsernameSchema. Keep
      // human labels readable on the wire; country identity retains the exact
      // name/flag independently of this transport/save username.
      players: [
        {
          clientID,
          username: country.name.replace(/'/g, "").replace(/&/g, "and"),
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
          nationPercent: this.aiPercent,
          personality: "mixed",
          fairResources: true,
          seed: this.seed,
        },
        modernMode: {
          scenario: "modern-world-v1",
          version: 1,
          dataHash: modernWorld.hash,
          countryId: this.countryId,
          balance: this.balance,
          victory: this.victory,
          targetPercent: this.targetPercent,
          protectionTicks: this.protectionSeconds * 10,
          capitalElimination: this.eliminateCapital,
        },
      },
    };
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
