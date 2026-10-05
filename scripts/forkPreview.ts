import { lookup } from "mrmime";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

// Local singleplayer preview of the production build, using its real EJS
// environment renderer. Account/ranked services are separate infrastructure.
process.env.GAME_ENV ??= "dev";
process.env.GIT_COMMIT ??= "DEV";
process.env.DOMAIN ??= "localhost";
process.env.TURNSTILE_SITE_KEY ??= "1x00000000000000000000AA";
const { renderHtmlContent } = await import("../src/server/RenderHtml");
const { clearRuntimeAssetManifestCache } =
  await import("../src/server/RuntimeAssetManifest");
const root = path.resolve("static"),
  port = Number(process.env.FORK_PREVIEW_PORT ?? 9002);
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403).end();
        return;
      }
      if (pathname === "/" || !path.extname(pathname)) {
        // A new build replaces hashed bundle names. Refresh its HTML together
        // with those assets instead of retaining references to removed files.
        clearRuntimeAssetManifestCache();
        const html = await renderHtmlContent(path.join(root, "index.html"), {
          perServer: false,
        });
        res
          .writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(html);
        return;
      }
      const bytes = await fs.readFile(file);
      res
        .writeHead(200, {
          "Content-Type": lookup(file) ?? "application/octet-stream",
          "Cache-Control": "no-cache",
        })
        .end(bytes);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end("Resource unavailable");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`OpenFront fork preview: http://127.0.0.1:${port}`),
  );
