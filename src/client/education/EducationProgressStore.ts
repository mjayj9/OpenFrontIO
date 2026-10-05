import {
  EDUCATION_VERSION,
  TUTORIAL_CHAPTERS,
  TutorialChapterID,
  TutorialProgressSnapshot,
} from "../hud/Tutorial";

const REQUEST_KEY = "openfront:requested-tutorial-chapter";

/** This saves course outcomes, not a running game's simulation state. */
export class EducationProgressStore {
  constructor(
    private readonly storage?: Pick<Storage, "getItem" | "setItem">,
  ) {}

  private getStorage(): Pick<Storage, "getItem" | "setItem"> {
    return this.storage ?? localStorage;
  }

  load(chapter: TutorialChapterID): TutorialProgressSnapshot | null {
    try {
      const raw =
        this.getStorage().getItem(this.key(chapter)) ??
        this.getStorage().getItem(`education.progress.v2.${chapter}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        (parsed.version !== EDUCATION_VERSION && parsed.version !== 2) ||
        (parsed.stepId !== null && typeof parsed.stepId !== "string") ||
        !parsed.outcomes ||
        typeof parsed.outcomes !== "object" ||
        Array.isArray(parsed.outcomes)
      )
        return null;
      // Existing lesson IDs retain their evidence. New lessons have no outcomes;
      // the original v2 record stays available for recovery.
      return { ...parsed, version: EDUCATION_VERSION };
    } catch {
      return null;
    }
  }

  save(
    chapter: TutorialChapterID,
    progress: TutorialProgressSnapshot,
  ): boolean {
    if (progress.version !== EDUCATION_VERSION) return false;
    try {
      this.getStorage().setItem(this.key(chapter), JSON.stringify(progress));
      return true;
    } catch {
      return false;
    }
  }

  private key(chapter: TutorialChapterID): string {
    // A curriculum update leaves the previous progress untouched for recovery.
    return `education.progress.v${EDUCATION_VERSION}.${chapter}`;
  }
}

export function requestChapter(chapter: TutorialChapterID): void {
  try {
    localStorage.setItem(REQUEST_KEY, chapter);
  } catch {
    // The guide still starts with the basic chapter if storage is blocked.
  }
}

export function consumeRequestedChapter(): TutorialChapterID | null {
  try {
    const requested = localStorage.getItem(REQUEST_KEY);
    localStorage.removeItem(REQUEST_KEY);
    return TUTORIAL_CHAPTERS.find((c) => c.id === requested)?.id ?? null;
  } catch {
    return null;
  }
}
