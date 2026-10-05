import type { ModernState } from "../../core/modern/ModernState";
import { translateText } from "../Utils";
import type { ReplayCamera } from "./ReplayCamera";

/** Reads recorded state only; replay viewing never issues a military intent. */
export function drawModernReplayOverlay(
  canvas: HTMLCanvasElement,
  state: ModernState | null,
  mapWidth: number,
  camera: ReplayCamera,
): void {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!state) return;
  const position = (tile: number) => ({
    x: ((tile % mapWidth) - camera.x) * camera.zoom + width / 2,
    y: (Math.floor(tile / mapWidth) - camera.y) * camera.zoom + height / 2,
  });
  const visible = (point: { x: number; y: number }) =>
    point.x >= -12 &&
    point.y >= -12 &&
    point.x <= width + 12 &&
    point.y <= height + 12;
  ctx.lineWidth = 2;
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  if (camera.zoom >= 2) {
    for (const port of state.ports) {
      const point = position(port.tile);
      if (!visible(point)) continue;
      ctx.fillStyle = port.level > 0 ? "#ffeb86" : "#b3b9bd";
      ctx.strokeStyle = "#101820";
      ctx.strokeText("⚓", point.x, point.y);
      ctx.fillText("⚓", point.x, point.y);
    }
    for (const base of state.bases) {
      const point = position(base.tile);
      if (!visible(point) || base.health <= 0) continue;
      ctx.fillStyle = "#b9bcff";
      ctx.strokeStyle = "#101820";
      ctx.fillRect(point.x - 10, point.y - 10, 20, 20);
      ctx.strokeRect(point.x - 10, point.y - 10, 20, 20);
    }
  }
  for (const force of state.forces) {
    if (
      force.phase === "destroyed" ||
      (camera.zoom < 2 && force.phase === "idle")
    )
      continue;
    const point = position(force.tile);
    if (!visible(point)) continue;
    ctx.fillStyle =
      force.branch === "air"
        ? "#b9bcff"
        : force.branch === "navy"
          ? "#89d8ff"
          : "#a2fff0";
    ctx.strokeStyle = "#101820";
    ctx.beginPath();
    if (force.branch === "air") {
      ctx.moveTo(point.x, point.y - 9);
      ctx.lineTo(point.x + 9, point.y + 7);
      ctx.lineTo(point.x, point.y + 3);
      ctx.lineTo(point.x - 9, point.y + 7);
    } else if (force.branch === "navy") {
      ctx.moveTo(point.x - 8, point.y - 5);
      ctx.lineTo(point.x + 8, point.y - 5);
      ctx.lineTo(point.x + 4, point.y + 6);
      ctx.lineTo(point.x - 4, point.y + 6);
    } else ctx.rect(point.x - 6, point.y - 6, 12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (camera.zoom >= 4) {
      const label = `${translateText(`modern_v2.kind.${force.kind}`)} · ${translateText(`modern_v2.phase.${force.phase}`)}`;
      ctx.strokeText(label, point.x, point.y + 22);
      ctx.fillStyle = "white";
      ctx.fillText(label, point.x, point.y + 22);
    }
  }
}
