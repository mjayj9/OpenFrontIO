import en from "../resources/education/en.json";
import ko from "../resources/education/ko.json";
import { EducationProgressStore } from "../src/client/education/EducationProgressStore";
import {
  EDUCATION_FEATURES,
  INTERNAL_GAME_CONFIG_KEYS,
  INTERNAL_INTENTS,
  INTERNAL_MODERN_CONFIG_KEYS,
  searchEducationFeatures,
} from "../src/client/education/FeatureRegistry";
import {
  chapterSteps,
  EDUCATION_VERSION,
  TUTORIAL_CHAPTERS,
  TUTORIAL_STEPS,
  TutorialProgress,
} from "../src/client/hud/Tutorial";
import { UnitType } from "../src/core/game/Game";
import { INPUT_ACTIONS } from "../src/core/game/KeybindingRegistry";
import { GameConfigSchema, IntentSchema } from "../src/core/Schemas";

describe("Public feature education coverage", () => {
  it("keeps every registered control and modern practice step translated in both languages", () => {
    for (const dictionary of [en, ko]) {
      for (const action of INPUT_ACTIONS) {
        const text =
          dictionary.input_actions[
            action.id as keyof typeof dictionary.input_actions
          ];
        expect(text?.label, action.id).toBeTruthy();
        expect(text?.description, action.id).toBeTruthy();
      }
      for (const step of TUTORIAL_STEPS.filter((step) =>
        step.id.startsWith("modern_"),
      )) {
        expect(
          dictionary.education.modern_steps[
            step.id as keyof typeof dictionary.education.modern_steps
          ],
          step.id,
        ).toBeTruthy();
      }
    }
  });
  it("covers every public intent and identifies internal protocol intents", () => {
    const covered = new Set(
      EDUCATION_FEATURES.flatMap((feature) => feature.intents),
    );
    for (const intent of IntentSchema.options) {
      const name = intent.shape.type.value;
      expect(
        covered.has(name) ||
          INTERNAL_INTENTS.includes(name as "mark_disconnected"),
        name,
      ).toBe(true);
    }
  });

  it("covers every unit including automatically generated units", () => {
    const covered = new Set(
      EDUCATION_FEATURES.flatMap((feature) => feature.units),
    );
    for (const unit of Object.values(UnitType))
      expect(covered.has(unit), unit).toBe(true);
  });

  it("covers public settings and explicitly excludes non-public fields", () => {
    const covered = new Set(
      EDUCATION_FEATURES.flatMap((feature) => feature.settings),
    );
    for (const key of Object.keys(GameConfigSchema.shape)) {
      expect(covered.has(key) || key in INTERNAL_GAME_CONFIG_KEYS, key).toBe(
        true,
      );
    }
  });

  it("has a unique feature ID, link and complete English/Korean lesson metadata", () => {
    expect(
      new Set(EDUCATION_FEATURES.map((feature) => feature.featureId)).size,
    ).toBe(EDUCATION_FEATURES.length);
    for (const feature of EDUCATION_FEATURES) {
      expect(feature.helpAnchor).toBe(`feature-${feature.featureId}`);
      for (const dictionary of [en, ko]) {
        const lesson =
          dictionary.education.features[
            feature.featureId as keyof typeof dictionary.education.features
          ];
        expect(lesson, feature.featureId).toBeDefined();
        for (const field of [
          "title",
          "description",
          "prerequisites",
          "exercise",
          "completion",
        ] as const)
          expect(
            lesson[field].trim().length,
            `${feature.featureId}.${field}`,
          ).toBeGreaterThan(1);
      }
    }
  });
  it("covers every public modern scenario setting and all eight practical chapters", () => {
    const covered = new Set(
      EDUCATION_FEATURES.flatMap((feature) => feature.settings),
    );
    for (const key of Object.keys(
      GameConfigSchema.shape.modernMode.unwrap().shape,
    )) {
      expect(
        covered.has(`modernMode.${key}`) || key in INTERNAL_MODERN_CONFIG_KEYS,
        key,
      ).toBe(true);
    }
    for (const id of [
      "regions",
      "population",
      "commands",
      "air",
      "climate",
      "ports",
      "nuclear",
      "ai",
    ]) {
      const chapter =
        `modern_${id}` as (typeof TUTORIAL_CHAPTERS)[number]["id"];
      expect(chapterSteps(chapter).length, chapter).toBeGreaterThan(0);
      for (const step of chapterSteps(chapter))
        expect(step.manual, step.id).not.toBe(true);
    }
  });

  it("maps all existing practical tutorial steps to a documented feature and valid chapters", () => {
    const covered = new Set(
      EDUCATION_FEATURES.flatMap((feature) => feature.tutorialSteps),
    );
    for (const step of TUTORIAL_STEPS)
      expect(covered.has(step.id), step.id).toBe(true);
    for (const chapter of TUTORIAL_CHAPTERS)
      expect(chapterSteps(chapter.id).every(Boolean)).toBe(true);
    expect(
      chapterSteps("basic").some((step) => step.id === "launch_atom"),
    ).toBe(false);
  });

  it("searches translated content and filters by chapter", () => {
    const translate = (key: string) => {
      const [, , id, field] = key.split(".");
      return (
        en.education.features[id as keyof typeof en.education.features]?.[
          field as "description"
        ] ?? key
      );
    };
    expect(
      searchEducationFeatures("automatically trains", translate).map(
        (feature) => feature.featureId,
      ),
    ).toEqual(["factory"]);
    expect(
      searchEducationFeatures("", translate, "naval").every(
        (feature) => feature.chapter === "naval",
      ),
    ).toBe(true);
  });
});

describe("Versioned course progress storage", () => {
  it("resumes the same chapter, preserves skipped outcomes and rejects different versions", () => {
    const progress = new TutorialProgress(chapterSteps("basic"));
    progress.skip();
    const restored = new TutorialProgress(chapterSteps("basic"));
    expect(restored.restore(progress.snapshot())).toBe(true);
    expect(restored.current()?.id).toBe("attack_wilderness");
    expect(restored.result().spawn).toBe("skipped");
    expect(
      restored.restore({
        ...progress.snapshot(),
        version: EDUCATION_VERSION + 1,
      }),
    ).toBe(false);
    expect(restored.current()?.id).toBe("attack_wilderness");
  });

  it("does not confuse browser progress storage with a simulation save", () => {
    const memory = new Map<string, string>();
    const store = new EducationProgressStore({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    });
    const snapshot = new TutorialProgress(chapterSteps("naval")).snapshot();
    expect(store.save("naval", snapshot)).toBe(true);
    expect(store.load("naval")).toEqual(snapshot);
    expect(store.load("basic")).toBeNull();
    expect([...memory.keys()]).toEqual([
      `education.progress.v${EDUCATION_VERSION}.naval`,
    ]);
  });

  it("handles quota errors and malformed data without overwriting existing progress", () => {
    const store = new EducationProgressStore({
      getItem: () => "{broken",
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(store.load("basic")).toBeNull();
    expect(store.save("basic", new TutorialProgress().snapshot())).toBe(false);
  });
});
