import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameConfig } from "../../core/Schemas";
import { AI_PERSONALITIES } from "../../core/ai/AIProfile";
import { translateText } from "../Utils";

@customElement("enhanced-ai-settings")
export class EnhancedAISettings extends LitElement {
  @property({ attribute: false }) value: GameConfig["enhancedAI"];
  createRenderRoot() {
    return this;
  }
  private change(patch: Partial<NonNullable<GameConfig["enhancedAI"]>>): void {
    this.emit({ ...this.value!, ...patch });
  }
  private emit(value: GameConfig["enhancedAI"]): void {
    this.dispatchEvent(
      new CustomEvent("enhanced-ai-change", {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    return html`<fieldset
      class="mt-6 p-4 rounded-xl border border-white/20 space-y-3 text-white"
    >
      <legend>${translateText("enhanced_ai.settings")}</legend>
      <label
        ><input
          type="checkbox"
          .checked=${Boolean(this.value)}
          @change=${(e: Event) =>
            this.emit(
              (e.target as HTMLInputElement).checked
                ? {
                    tribePercent: 25,
                    nationPercent: 25,
                    personality: "mixed",
                    fairResources: true,
                    seed: 1,
                  }
                : undefined,
            )}
        />
        ${translateText("enhanced_ai.enable")}</label
      >
      ${this.value
        ? html`<div class="flex flex-wrap gap-4">
              ${(["tribePercent", "nationPercent"] as const).map(
                (key) =>
                  html`<label
                    >${translateText(`enhanced_ai.${key}`)}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      class="bg-gray-800 w-20"
                      .value=${String(this.value![key])}
                      @change=${(e: Event) =>
                        this.change({
                          [key]: Math.min(
                            100,
                            Math.max(
                              0,
                              Math.round(
                                Number((e.target as HTMLInputElement).value) ||
                                  0,
                              ),
                            ),
                          ),
                        })}
                    />%</label
                  >`,
              )}
              <label
                >${translateText("enhanced_ai.personality")}
                <select
                  class="bg-gray-800"
                  .value=${this.value.personality}
                  @change=${(e: Event) =>
                    this.change({
                      personality: (e.target as HTMLSelectElement)
                        .value as NonNullable<
                        GameConfig["enhancedAI"]
                      >["personality"],
                    })}
                >
                  ${["mixed", ...AI_PERSONALITIES].map(
                    (p) =>
                      html`<option value=${p}>
                        ${translateText(`enhanced_ai.personality_${p}`)}
                      </option>`,
                  )}
                </select></label
              >
              <label
                >${translateText("modern.seed")}
                <input
                  class="bg-gray-800 w-24"
                  type="number"
                  min="0"
                  max="4294967295"
                  .value=${String(this.value.seed)}
                  @change=${(e: Event) =>
                    this.change({
                      seed: Math.min(
                        4294967295,
                        Math.max(
                          0,
                          Math.round(
                            Number((e.target as HTMLInputElement).value) || 0,
                          ),
                        ),
                      ),
                    })}
              /></label>
            </div>
            <label
              ><input
                type="checkbox"
                .checked=${this.value.fairResources}
                @change=${(e: Event) =>
                  this.change({
                    fairResources: (e.target as HTMLInputElement).checked,
                  })}
              />
              ${translateText("enhanced_ai.fair_resources")}</label
            >
            <p class="text-sm text-white/80">
              ${translateText(
                this.value.fairResources
                  ? "enhanced_ai.fair_description"
                  : "enhanced_ai.challenge_description",
              )}
            </p>
            <p class="text-sm">
              ${translateText("enhanced_ai.percent_description")}
            </p>`
        : null}
    </fieldset>`;
  }
}
