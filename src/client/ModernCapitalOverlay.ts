import { Cell } from "../core/game/Game";
import { modernWorld } from "../core/game/ModernWorld";
import { TransformHandler } from "./TransformHandler";
import { GameView } from "./view";

/** Free capital markers are a read-only overlay; no simulation decisions. */
export function mountModernCapitalOverlay(
  game: GameView,
  transform: TransformHandler,
): () => void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:10";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const context = canvas.getContext("2d")!;
  let enabled = true,
    frame = 0,
    stopped = false;
  const abort = new AbortController();
  document.addEventListener(
    "modern-capitals",
    (e: Event) => {
      enabled = (e as CustomEvent<boolean>).detail;
    },
    { signal: abort.signal },
  );
  const draw = () => {
    if (stopped) return;
    const width = innerWidth,
      height = innerHeight,
      dpr = Math.min(devicePixelRatio, 2);
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (enabled && !game.inSpawnPhase()) {
      context.font = "bold 13px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 3;
      context.strokeStyle = "#101820";
      for (const country of modernWorld.countries) {
        const point = transform.worldToScreenCoordinates(
          new Cell(country.capital[0], country.capital[1]),
        );
        if (point.x < 0 || point.y < 0 || point.x > width || point.y > height)
          continue;
        const owner = game.owner(
          game.ref(country.capital[0], country.capital[1]),
        );
        context.fillStyle = owner === game.myPlayer() ? "#fff799" : "#ffffff";
        context.strokeText("★", point.x, point.y);
        context.fillText("★", point.x, point.y);
        if (transform.scale >= 6) {
          context.font = "11px sans-serif";
          context.strokeText(country.capitalName, point.x, point.y + 14);
          context.fillText(country.capitalName, point.x, point.y + 14);
          context.font = "bold 13px sans-serif";
        }
      }
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    abort.abort();
    canvas.remove();
  };
}
