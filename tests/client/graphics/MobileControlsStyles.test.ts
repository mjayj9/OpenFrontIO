// @vitest-environment node
import fs from "fs";
import { transform } from "lightningcss";
import path from "path";

it("keeps the standard mobile backdrop override after the production CSS optimizer", () => {
  const stylesheet = fs.readFileSync(path.resolve("src/client/styles.css"));
  const compiled = transform({
    filename: "styles.css",
    code: stylesheet,
    minify: true,
    targets: { chrome: 111 << 16 },
  }).code.toString();
  // Chromium ignores the webkit-only property. Declaration order previously
  // let minification discard the standard override, moving fixed controls
  // below the mobile viewport despite the source appearing correct.
  expect(compiled).toMatch(
    /@media\s*\(width<=1023px\),\(pointer:coarse\)\{\.hud-controls-surface\{backdrop-filter:none\}/,
  );
  const shell = fs.readFileSync(path.resolve("index.html"), "utf8");
  expect(shell).toMatch(
    /class="hud-controls-surface[^"]*"\s*>\s*<control-panel[^>]*><\/control-panel>\s*<unit-display/,
  );
});
