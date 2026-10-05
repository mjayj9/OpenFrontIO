/** Run: npx tsx scripts/mergeModernTranslations.ts */
import fs from "node:fs";
import path from "node:path";

type Dictionary = Record<string, unknown>;
// Exact retired copy, not a blanket prefix exemption from translation checks.
// The replaced actions still exist in the shared input_actions catalogue.
const obsoleteKeys = (
  JSON.parse(
    fs.readFileSync("resources/education/obsolete-repair-keys.json", "utf8"),
  ) as { keys: string[] }
).keys;
function removeObsoleteTranslations(target: Dictionary): void {
  for (const key of obsoleteKeys) {
    const parts = key.split(".");
    let parent: Dictionary | undefined = target;
    for (const segment of parts.slice(0, -1)) {
      const value: unknown = parent?.[segment];
      parent =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Dictionary)
          : undefined;
    }
    if (parent) delete parent[parts[parts.length - 1]];
  }
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted((value as Dictionary)[key])]),
    );
  return value;
}
function merge(target: Dictionary, additions: Dictionary): Dictionary {
  for (const [key, value] of Object.entries(additions)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const previous = target[key];
      const nested =
        previous && typeof previous === "object" && !Array.isArray(previous)
          ? (previous as Dictionary)
          : {};
      target[key] = merge(nested, value as Dictionary);
    } else target[key] = value;
  }
  return target;
}
for (const language of ["en", "ko"]) {
  const sourceFilename = `resources/education/modern-v2.${language}.json`;
  const source = JSON.parse(
    fs.readFileSync(sourceFilename, "utf8"),
  ) as Dictionary & { modern_v2: { reason: Dictionary; errors?: Dictionary } };
  // Server errors and worker previews use one shared reason namespace.
  delete source.modern_v2.errors;
  removeObsoleteTranslations(source);
  fs.writeFileSync(
    sourceFilename,
    JSON.stringify(sorted(source), null, 2) + "\n",
  );
  // Keep fork repair translations as a separate source. Explicit English and
  // Korean requirements override the upstream translation-file restriction.
  const repairFilename = `resources/education/modern-repair.${language}.json`;
  if (fs.existsSync(repairFilename)) {
    const repair = JSON.parse(
      fs.readFileSync(repairFilename, "utf8"),
    ) as Dictionary;
    removeObsoleteTranslations(repair);
    merge(source, repair);
    fs.writeFileSync(
      repairFilename,
      JSON.stringify(sorted(repair), null, 2) + "\n",
    );
  }
  for (const directory of ["resources/education", "resources/lang"]) {
    const filename = path.join(directory, `${language}.json`);
    const existing = JSON.parse(
      fs.readFileSync(filename, "utf8"),
    ) as Dictionary;
    const merged = merge(existing, source);
    removeObsoleteTranslations(merged);
    delete (merged.modern_v2 as Dictionary).errors;
    fs.writeFileSync(filename, JSON.stringify(sorted(merged), null, 2) + "\n");
  }
}
