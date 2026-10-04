import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  deleteSave,
  exportSave,
  importSave,
  listSaves,
  resumeSave,
  reviewSave,
} from "./SingleplayerSaves";
import { textDirection, translateText } from "./Utils";

type SaveSummary = Awaited<ReturnType<typeof listSaves>>[number];

@customElement("save-manager")
export class SaveManager extends BaseModal {
  @state() private saves: SaveSummary[] = [];
  @state() private busy = false;
  @state() private loaded = false;
  @state() private error = "";
  @state() private status = "";
  @state() private deleting: string | null = null;

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("saves.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected onOpen(): void {
    this.deleting = null;
    this.error = "";
    this.status = "";
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    this.busy = true;
    try {
      this.saves = await listSaves();
      this.loaded = true;
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy = false;
    }
  }

  private showError(error: unknown): void {
    this.error = `${translateText("saves.error")} ${error instanceof Error ? error.message : String(error)}`;
  }

  private async perform(
    action: () => Promise<void>,
    statusKey?: string,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.status = "";
    try {
      await action();
      if (statusKey) this.status = translateText(statusKey);
      this.saves = await listSaves();
      this.loaded = true;
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy = false;
    }
  }

  private async importSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.perform(async () => {
      await importSave(file);
    }, "saves.imported");
    input.value = "";
  }

  protected renderBody() {
    return html`<div dir=${textDirection()} class="p-4 text-white">
      <p class="text-sm text-gray-300 mb-3">
        ${translateText("saves.explanation")}
      </p>
      <div class="flex flex-wrap gap-2 mb-3">
        <label class="rounded border border-blue-400 px-3 py-2 cursor-pointer">
          ${translateText("saves.import")}
          <input
            type="file"
            accept=".json,.ofsave,application/json"
            class="sr-only"
            ?disabled=${this.busy}
            @change=${(event: Event) => void this.importSelected(event)}
          />
        </label>
        <button
          class="rounded border border-gray-400 px-3 py-2"
          ?disabled=${this.busy}
          @click=${() => void this.refresh()}
        >
          ${translateText("saves.refresh")}
        </button>
      </div>
      ${this.busy
        ? html`<p role="status">${translateText("saves.working")}</p>`
        : nothing}
      ${this.error
        ? html`<p role="alert" class="text-yellow-200 mb-3">${this.error}</p>`
        : nothing}
      ${this.status
        ? html`<p role="status" class="text-green-200 mb-3">${this.status}</p>`
        : nothing}
      ${this.loaded && this.saves.length === 0
        ? html`<p>${translateText("saves.empty")}</p>`
        : nothing}
      <ul class="space-y-3">
        ${this.saves.map(
          (save) =>
            html`<li class="rounded-lg border border-white/20 p-3">
              <p class="font-semibold break-words">${save.name}</p>
              <p class="text-xs text-gray-300">
                ${translateText("saves.details", {
                  tick: save.tick,
                  date: new Date(save.createdAt).toLocaleString(),
                  build: save.build,
                })}
              </p>
              ${this.deleting === save.id
                ? html`<div class="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      >${translateText("saves.confirm_delete", {
                        name: save.name,
                      })}</span
                    >
                    <button
                      class="rounded border border-red-400 px-2 py-1"
                      ?disabled=${this.busy}
                      @click=${() =>
                        void this.perform(async () => {
                          await deleteSave(save.id);
                          this.deleting = null;
                        }, "saves.deleted")}
                    >
                      ${translateText("saves.delete")}
                    </button>
                    <button
                      class="rounded border px-2 py-1"
                      @click=${() => (this.deleting = null)}
                    >
                      ${translateText("common.cancel")}
                    </button>
                  </div>`
                : html`<div class="mt-2 flex flex-wrap gap-2">
                    <button
                      class="rounded bg-blue-700 px-3 py-1"
                      ?disabled=${this.busy}
                      @click=${() =>
                        void this.perform(async () => {
                          await resumeSave(save.id);
                          this.close();
                        })}
                    >
                      ${translateText("saves.continue")}
                    </button>
                    <button
                      class="rounded border border-blue-400 px-3 py-1"
                      ?disabled=${this.busy}
                      @click=${() =>
                        void this.perform(async () => {
                          await reviewSave(save.id);
                          this.close();
                        })}
                    >
                      ${translateText("saves.review")}
                    </button>
                    <button
                      class="rounded border border-gray-400 px-3 py-1"
                      ?disabled=${this.busy}
                      @click=${() =>
                        void this.perform(
                          () => exportSave(save.id),
                          "saves.exported",
                        )}
                    >
                      ${translateText("saves.export")}
                    </button>
                    <button
                      class="rounded border border-gray-500 px-3 py-1"
                      ?disabled=${this.busy}
                      @click=${() => (this.deleting = save.id)}
                    >
                      ${translateText("saves.delete")}
                    </button>
                  </div>`}
            </li>`,
        )}
      </ul>
      <p class="text-xs text-gray-300 mt-4">
        ${translateText("saves.compatibility")}
      </p>
    </div>`;
  }
}
