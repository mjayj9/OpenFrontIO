/** Run: npx tsx scripts/mergeModernTranslations.ts */
import fs from "node:fs";
import path from "node:path";

type Dictionary = Record<string, unknown>;
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
  fs.writeFileSync(
    sourceFilename,
    JSON.stringify(sorted(source), null, 2) + "\n",
  );
  for (const directory of ["resources/education", "resources/lang"]) {
    const filename = path.join(directory, `${language}.json`);
    const existing = JSON.parse(
      fs.readFileSync(filename, "utf8"),
    ) as Dictionary;
    const merged = merge(existing, source);
    delete (merged.modern_v2 as Dictionary).errors;
    fs.writeFileSync(filename, JSON.stringify(sorted(merged), null, 2) + "\n");
  }
}
