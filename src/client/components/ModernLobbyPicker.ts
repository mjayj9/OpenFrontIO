import { html, LitElement, PropertyValues, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import {
  modernCountry,
  ModernCountry,
  modernWorld,
} from "../../core/game/ModernWorld";
import { ClientInfo, GameConfig } from "../../core/Schemas";
import type { LangSelector } from "../LangSelector";
import { ModernLobbyStatusEvent, SendSelectCountryEvent } from "../Transport";
import { translateText } from "../Utils";

// Exactly the scenario ownership raster used by the simulation, including
// overseas territories and the explicit representation of small countries.
const paths = new Map<number, string>();
for (const [index, start, count] of modernWorld.runs) {
  let position = start,
    remaining = count;
  let path = paths.get(index) ?? "";
  while (remaining > 0) {
    const x = position % modernWorld.width;
    const y = Math.floor(position / modernWorld.width);
    const width = Math.min(remaining, modernWorld.width - x);
    path += `M${x} ${y}h${width}v1h-${width}z`;
    position += width;
    remaining -= width;
  }
  paths.set(index, path);
}

@customElement("modern-lobby-picker")
export class ModernLobbyPicker extends LitElement {
  @property({ attribute: false }) clients: ClientInfo[] = [];
  @property() currentClientID = "";
  @property({ attribute: false }) eventBus: EventBus | null = null;
  @property({ attribute: false }) mode: GameConfig["modernMode"];
  @state() private query = "";
  @state() private previewId = "KOR";
  @state() private status = "";
  private subscribedBus: EventBus | null = null;
  private readonly onStatus = (event: ModernLobbyStatusEvent) => {
    this.status = translateText(
      `modern_lobby.${event.status.error ?? "reserved"}`,
      {
        country: this.countryName(
          modernCountry(event.status.countryId ?? this.previewId),
        ),
      },
    );
  };
  createRenderRoot() {
    return this;
  }
  protected updated(changes: PropertyValues): void {
    if (changes.has("eventBus") && this.eventBus !== this.subscribedBus) {
      this.subscribedBus?.off(ModernLobbyStatusEvent, this.onStatus);
      this.subscribedBus = this.eventBus;
      this.subscribedBus?.on(ModernLobbyStatusEvent, this.onStatus);
    }
    if (changes.has("clients")) {
      const old = changes.get("clients") as ClientInfo[] | undefined;
      const previous = old?.find(
        (c) => c.clientID === this.currentClientID,
      )?.countryId;
      const current = this.clients.find(
        (c) => c.clientID === this.currentClientID,
      )?.countryId;
      if (current && current !== previous) this.previewId = current;
    }
  }
  disconnectedCallback(): void {
    this.subscribedBus?.off(ModernLobbyStatusEvent, this.onStatus);
    this.subscribedBus = null;
    super.disconnectedCallback();
  }
  connectedCallback(): void {
    super.connectedCallback();
    if (this.eventBus && !this.subscribedBus) {
      this.subscribedBus = this.eventBus;
      this.subscribedBus.on(ModernLobbyStatusEvent, this.onStatus);
    }
  }
  private countryName(country: ModernCountry): string {
    return document
      .querySelector<LangSelector>("lang-selector")
      ?.currentLang?.startsWith("ko")
      ? country.nameKo
      : country.name;
  }
  private holder(id: string): ClientInfo | undefined {
    return this.clients.find((c) => !c.spectator && c.countryId === id);
  }
  private reserve(): void {
    this.status = translateText("modern_lobby.pending");
    this.eventBus?.emit(new SendSelectCountryEvent(this.previewId));
  }
  render() {
    const me = this.clients.find((c) => c.clientID === this.currentClientID);
    const selected = modernCountry(this.previewId);
    const occupied = this.holder(selected.id);
    const canReserve = Boolean(
      me &&
      !me.spectator &&
      (!occupied || occupied.clientID === this.currentClientID) &&
      this.eventBus,
    );
    const factor =
      this.mode?.balance === "asymmetric"
        ? Math.min(4, 1 + Math.floor(selected.tiles / 12000))
        : 1;
    const list = modernWorld.countries.filter((c) =>
      `${c.name} ${c.nameKo} ${c.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase()),
    );
    return html`<section
      class="mt-4 p-4 border border-white/20 rounded-xl text-white space-y-3"
    >
      <h3 class="text-lg">${translateText("modern_lobby.title")}</h3>
      <p>${translateText("modern_lobby.instructions")}</p>
      <svg
        viewBox="0 0 2000 1000"
        aria-label=${translateText("modern.map_selection")}
        role="img"
        style="width:100%;max-height:30dvh;background:#18384e;aspect-ratio:2/1"
      >
        ${modernWorld.countries.map((c) => {
          const holder = this.holder(c.id);
          return svg`<path d=${paths.get(c.index) ?? ""} fill=${c.id === selected.id ? "#fff799" : holder ? "#666f80" : `hsl(${(c.index * 137) % 360} 55% 58%)`} stroke="#142b38" stroke-width=${c.id === selected.id ? 3 : 0.5} tabindex="0" role="button" aria-label=${this.countryName(c)} @click=${() => (this.previewId = c.id)} @keydown=${(
            event: KeyboardEvent,
          ) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              this.previewId = c.id;
            }
          }}><title>${this.countryName(c)}${holder ? ` — ${holder.username}` : ""}</title></path>`;
        })}
      </svg>
      <div class="grid md:grid-cols-2 gap-3">
        <div>
          <input
            type="search"
            class="p-2 bg-gray-800 w-full"
            aria-label=${translateText("modern.search")}
            placeholder=${translateText("modern.search")}
            .value=${this.query}
            @input=${(event: Event) =>
              (this.query = (event.target as HTMLInputElement).value)}
          />
          <select
            size="6"
            class="p-2 bg-gray-800 w-full mt-2"
            aria-label=${translateText("modern.country")}
            .value=${this.previewId}
            @change=${(event: Event) =>
              (this.previewId = (event.target as HTMLSelectElement).value)}
          >
            ${list.map(
              (c) =>
                html`<option value=${c.id} ?selected=${c.id === this.previewId}>
                  ${this.countryName(c)}${this.holder(c.id)
                    ? ` (${this.holder(c.id)!.username})`
                    : ""}
                </option>`,
            )}
          </select>
        </div>
        <div class="p-3 bg-gray-800 rounded">
          <h4 class="font-bold">
            ${selected.flag
              ? html`<img
                  src=${assetUrl(`flags/${selected.flag}.svg`)}
                  alt=""
                  style="height:1.2em;display:inline"
                />`
              : null}
            ${this.countryName(selected)}
          </h4>
          <p>${translateText("modern.capital")}: ${selected.capitalName}</p>
          <p>
            ${translateText("modern.neighbors")}:
            ${selected.neighbors
              .map((id) => this.countryName(modernCountry(id)))
              .join(", ") || translateText("modern.island")}
          </p>
          <p>
            ${translateText("modern.initial", {
              tiles: selected.tiles,
              troops: 80000 * factor,
              gold: 400000 * factor,
            })}
          </p>
          <p>
            ${translateText(
              selected.represented
                ? "modern.small_country"
                : "modern.recommendation",
            )}
          </p>
          <p>
            ${occupied
              ? translateText("modern_lobby.held_by", {
                  player: occupied.username,
                })
              : translateText("modern_lobby.available")}
          </p>
          <button
            type="button"
            class="mt-2 p-2 rounded bg-blue-700 disabled:opacity-50"
            ?disabled=${!canReserve}
            @click=${this.reserve}
          >
            ${translateText("modern_lobby.reserve")}
          </button>
          <p role="status">${this.status}</p>
          <p>
            ${me?.countryId
              ? translateText("modern_lobby.reserved", {
                  country: this.countryName(modernCountry(me.countryId)),
                })
              : translateText(
                  me?.spectator
                    ? "modern_lobby.not_player"
                    : "modern_lobby.not_ready",
                )}
          </p>
        </div>
      </div>
      <ul>
        ${this.clients
          .filter((c) => !c.spectator)
          .map(
            (c) =>
              html`<li>
                ${c.username}:
                ${c.countryId
                  ? this.countryName(modernCountry(c.countryId))
                  : translateText("modern_lobby.unselected")}
              </li>`,
          )}
      </ul>
    </section>`;
  }
}
