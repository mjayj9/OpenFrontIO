import type { ModernForceState } from "../../core/modern/ModernForceTypes";
import type { ModernState } from "../../core/modern/ModernState";
import {
  curvedPath,
  drawCommandArrow,
  modernMapImage,
} from "../ModernMapDisplay";
import { translateText } from "../Utils";
import type { ReplayCamera } from "./ReplayCamera";

const recordedPaths = new WeakMap<
  ModernForceState,
  { tile: number; index: number; segments: ReturnType<typeof curvedPath> }
>();

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
    for (const base of state.bases) {
      const point = position(base.tile);
      if (!visible(point) || base.health <= 0) continue;
      if (base.branch === "navy") continue;
      const icon = modernMapImage(
        base.branch === "army" ? "armybase" : "airbase",
      );
      if (icon.complete && icon.naturalWidth)
        ctx.drawImage(icon, point.x - 13, point.y - 13, 26, 26);
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
    if (
      force.branch !== "navy" &&
      !(
        force.branch === "army" &&
        force.command?.viaTransport &&
        force.unitId !== null
      )
    ) {
      const icon = modernMapImage(force.branch);
      ctx.save();
      if (force.branch === "army")
        ctx.filter = "brightness(0) invert(1) drop-shadow(0 1px 1px #101820)";
      if (icon.complete && icon.naturalWidth)
        ctx.drawImage(icon, point.x - 12, point.y - 12, 24, 24);
      ctx.restore();
    }
    ctx.strokeStyle = "#101820";
    if (force.command && force.path.length > 1 && camera.zoom >= 4) {
      let cached = recordedPaths.get(force);
      if (
        !cached ||
        cached.tile !== force.tile ||
        cached.index !== force.pathIndex
      ) {
        const path = [force.tile, ...force.path.slice(force.pathIndex + 1)];
        cached = {
          tile: force.tile,
          index: force.pathIndex,
          segments: curvedPath(
            path.map((tile) => ({
              x: (tile % mapWidth) + 0.5,
              y: Math.floor(tile / mapWidth) + 0.5,
            })),
            () => force.branch === "air",
          ),
        };
        recordedPaths.set(force, cached);
      }
      drawCommandArrow(
        ctx,
        cached.segments,
        (point) => ({
          x: (point.x - camera.x) * camera.zoom + width / 2,
          y: (point.y - camera.y) * camera.zoom + height / 2,
        }),
        force.branch,
        "active",
        ["strike", "attack"].includes(force.command.kind),
      );
    }
    if (camera.zoom >= 4) {
      const label = `${translateText(`modern_v2.kind.${force.kind}`)} · ${translateText(`modern_v2.phase.${force.phase}`)}`;
      ctx.strokeText(label, point.x, point.y + 22);
      ctx.fillStyle = "white";
      ctx.fillText(label, point.x, point.y + 22);
    }
  }
}
