import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../../SaveManager";
import type { SaveManager } from "../../SaveManager";
import { textDirection, translateText } from "../../Utils";

export interface SavePanelOptions {
  save: (name?: string, automatic?: boolean) => Promise<void>;
  getProgress?: () => string;
  restart?: () => void;
  setAutosave?: (enabled: boolean) => void;
  autosave?: boolean;
  setCapitalMarkers?: (enabled: boolean) => void;
}

/** UI only. The runner owns pausing, exact tick snapshots and autosave timing. */
@customElement("save-panel")
export class SavePanel extends LitElement {
  @state() private expanded = false;
  @state() private saving = false;
  @state() private name = "";
  @state() private message = "";
  @state() private failed = false;
  @state() private autosave = false;
  @state() private capitalMarkers = true;
  @state() private progress = "";
  private options: SavePanelOptions | null = null;

  createRenderRoot() {
    return this;
  }

  public configure(options: SavePanelOptions): void {
    this.options = options;
    this.autosave = options.autosave ?? false;
    this.tick();
  }

  public tick(): void {
    this.progress = this.options?.getProgress?.() ?? "";
  }

  public reportSaveError(error: unknown): void {
    this.failed = true;
    this.message = `${translateText("saves.error")} ${error instanceof Error ? error.message : String(error)}`;
  }

  private async save(): Promise<void> {
    if (!this.options || this.saving) return;
    this.saving = true;
    this.failed = false;
    this.message = "";
    try {
      await this.options.save(this.name.trim() || undefined, false);
      this.message = translateText("saves.saved");
    } catch (error) {
      this.reportSaveError(error);
    } finally {
      this.saving = false;
    }
  }

  private openManager(): void {
    (this.querySelector("save-manager") as SaveManager | null)?.open();
  }

  render() {
    if (!this.options) return nothing;
    // Menus stay above the guide (960) and hover information (1001).
    return html`<div
        dir=${textDirection()}
        class="fixed top-14 right-2 z-[1002] pointer-events-auto max-w-[min(24rem,calc(100vw-1rem))] rounded-lg bg-gray-900/90 text-white p-2 shadow-lg"
        @contextmenu=${(event: MouseEvent) => event.preventDefault()}
      >
        <button
          class="text-sm font-semibold"
          aria-expanded=${this.expanded}
          @click=${() => (this.expanded = !this.expanded)}
        >
          ${translateText("saves.menu")} ${this.expanded ? "▴" : "▾"}
        </button>
        ${this.expanded
          ? html`<div class="mt-2 flex flex-col gap-2">
              ${this.options.setCapitalMarkers
                ? html`<label class="text-xs"
                    ><input
                      type="checkbox"
                      .checked=${this.capitalMarkers}
                      @change=${(e: Event) => {
                        this.capitalMarkers = (
                          e.target as HTMLInputElement
                        ).checked;
                        this.options?.setCapitalMarkers?.(this.capitalMarkers);
                      }}
                    />
                    ${translateText("modern.capital_markers")}</label
                  >`
                : nothing}
              ${this.progress
                ? html`<p class="text-xs text-blue-200" role="status">
                    ${this.progress}
                  </p>`
                : nothing}
              <input
                type="text"
                maxlength="80"
                class="rounded bg-gray-800 border border-gray-500 p-1"
                .value=${this.name}
                placeholder=${translateText("saves.name")}
                aria-label=${translateText("saves.name")}
                @input=${(event: Event) =>
                  (this.name = (event.target as HTMLInputElement).value)}
              />
              <div class="flex flex-wrap gap-2">
                <button
                  class="rounded bg-blue-700 px-2 py-1"
                  ?disabled=${this.saving}
                  @click=${() => void this.save()}
                >
                  ${translateText(this.saving ? "saves.working" : "saves.save")}
                </button>
                <button
                  class="rounded border border-gray-500 px-2 py-1"
                  @click=${() => this.openManager()}
                >
                  ${translateText("saves.manage")}
                </button>
                ${this.options.restart
                  ? html`<button
                      class="rounded border border-gray-500 px-2 py-1"
                      @click=${() => this.options?.restart?.()}
                    >
                      ${translateText("saves.restart")}
                    </button>`
                  : nothing}
              </div>
              ${this.options.setAutosave
                ? html`<label class="text-xs flex gap-2 items-center"
                    ><input
                      type="checkbox"
                      .checked=${this.autosave}
                      @change=${(event: Event) => {
                        this.autosave = (
                          event.target as HTMLInputElement
                        ).checked;
                        this.options?.setAutosave?.(this.autosave);
                      }}
                    />${translateText("saves.autosave")}</label
                  >`
                : nothing}
              ${this.message
                ? html`<p
                    role=${this.failed ? "alert" : "status"}
                    class=${this.failed
                      ? "text-xs text-yellow-200"
                      : "text-xs text-green-200"}
                  >
                    ${this.message}
                  </p>`
                : nothing}
            </div>`
          : nothing}
        ${!this.expanded && this.failed
          ? html`<p role="alert" class="text-xs text-yellow-200">
              ${translateText("saves.failed_short")}
            </p>`
          : nothing}
      </div>
      <save-manager></save-manager>`;
  }
}
