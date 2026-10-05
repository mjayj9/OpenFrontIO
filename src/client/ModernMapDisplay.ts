import { assetUrl } from "../core/AssetUrls";
import type { ModernBranch } from "../core/modern/ModernForceTypes";

/** Existing monochrome icons remain the source for the army, ships and ports. */
export const MODERN_ICONS = {
  army: assetUrl("images/SoldierIcon.svg"),
  navy: assetUrl("images/BattleshipIconWhite.svg"),
  air: assetUrl("images/AircraftIconWhite.svg"),
  armybase: assetUrl("images/ArmyBaseIconWhite.svg"),
  navybase: assetUrl("images/PortIcon.svg"),
  airbase: assetUrl("images/AirbaseIconWhite.svg"),
  capital: assetUrl("images/CrownIcon.svg"),
} as const;

const images = new Map<string, HTMLImageElement>();
export function modernMapImage(
  key: keyof typeof MODERN_ICONS,
): HTMLImageElement {
  let image = images.get(key);
  if (!image) {
    image = new Image();
    image.src = MODERN_ICONS[key];
    images.set(key, image);
  }
  return image;
}

export interface MapPoint {
  x: number;
  y: number;
}
export interface ArrowSegment {
  from: MapPoint;
  to: MapPoint;
  control: MapPoint | null;
}

/** A small curve is allowed only inside traversable terrain. Path corners stay
 * at their real waypoint, so smoothing never cuts a strait or land corner. */
export function curvedPath(
  points: readonly MapPoint[],
  passable: (point: MapPoint) => boolean,
): ArrowSegment[] {
  const compact: MapPoint[] = [];
  for (const point of points) {
    const last = compact[compact.length - 1];
    if (last?.x === point.x && last.y === point.y) continue;
    const previous = compact[compact.length - 2];
    if (
      previous &&
      last &&
      (last.x - previous.x) * (point.y - last.y) ===
        (last.y - previous.y) * (point.x - last.x) &&
      (last.x - previous.x) * (point.x - last.x) +
        (last.y - previous.y) * (point.y - last.y) >
        0
    )
      compact.pop();
    compact.push(point);
  }
  return compact.slice(1).map((to, index) => {
    const from = compact[index];
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const bend = Math.min(1.5, length * 0.08);
    const control = {
      x: (from.x + to.x) / 2 - (dy / length) * bend,
      y: (from.y + to.y) / 2 + (dx / length) * bend,
    };
    // Sampling at half-tile intervals tests every crossed tile. Rendering is
    // read-only; it does not determine the simulation's route.
    const samples = Math.max(2, Math.ceil(length * 2));
    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples,
        u = 1 - t;
      if (
        !passable({
          x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
          y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
        })
      )
        return { from, to, control: null };
    }
    return { from, to, control };
  });
}

export function drawCommandArrow(
  context: CanvasRenderingContext2D,
  segments: readonly ArrowSegment[],
  screen: (point: MapPoint) => MapPoint,
  branch: ModernBranch,
  state: "preview" | "active" | "queued",
  attack = false,
): void {
  if (!segments.length) return;
  context.save();
  context.strokeStyle = attack
    ? "#f87171"
    : branch === "navy"
      ? "#89d8ff"
      : branch === "air"
        ? "#c4b5fd"
        : "#fff799";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = state === "active" ? 2.5 : 1.8;
  context.globalAlpha = state === "queued" ? 0.5 : 0.95;
  context.setLineDash(
    state === "active" ? [] : state === "queued" ? [2, 6] : [6, 4],
  );
  context.beginPath();
  const start = screen(segments[0].from);
  context.moveTo(start.x, start.y);
  for (const segment of segments) {
    const end = screen(segment.to);
    if (segment.control) {
      const control = screen(segment.control);
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
    } else context.lineTo(end.x, end.y);
  }
  context.stroke();
  const last = segments[segments.length - 1];
  const end = screen(last.to),
    previous = screen(last.control ?? last.from);
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - 9 * Math.cos(angle - 0.45),
    end.y - 9 * Math.sin(angle - 0.45),
  );
  context.lineTo(
    end.x - 9 * Math.cos(angle + 0.45),
    end.y - 9 * Math.sin(angle + 0.45),
  );
  context.closePath();
  context.fill();
  context.restore();
}
