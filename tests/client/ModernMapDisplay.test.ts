import { describe, expect, it, vi } from "vitest";
import {
  curvedPath,
  drawCommandArrow,
} from "../../src/client/ModernMapDisplay";
import { TransformHandler } from "../../src/client/TransformHandler";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { Cell } from "../../src/core/game/Game";

describe("modern command arrows follow real terrain and viewport coordinates", () => {
  it("slightly curves a straight traversable route and preserves every terrain corner", () => {
    const points = [
      { x: 3.5, y: 4.5 },
      { x: 4.5, y: 4.5 },
      { x: 5.5, y: 4.5 },
      { x: 5.5, y: 5.5 },
    ];
    const segments = curvedPath(points, () => true);
    expect(segments).toHaveLength(2);
    expect(segments[0].control?.y).toBeGreaterThan(4.5);
    expect(segments[0].to).toEqual(points[2]);
    expect(segments[1].from).toEqual(points[2]);
    expect(segments[1].to).toEqual(points[3]);
  });
  it("does not smooth through a nontraversable neighboring tile at a coastal boundary", () => {
    const seen: number[] = [];
    const segments = curvedPath(
      [
        { x: 1.5, y: 3.5 },
        { x: 20.5, y: 3.5 },
      ],
      (point) => {
        seen.push(point.y);
        return Math.floor(point.y) === 3;
      },
    );
    expect(seen.some((y) => y >= 4)).toBe(true);
    expect(segments[0].control).toBeNull();
    expect(segments[0].from).toEqual({ x: 1.5, y: 3.5 });
    expect(segments[0].to).toEqual({ x: 20.5, y: 3.5 });
  });
  it("reprojects the same world path and arrowhead after pan, zoom and canvas relocation", () => {
    const canvas = document.createElement("canvas");
    let rectangle = { left: 12, top: 34, width: 600, height: 300 } as DOMRect;
    canvas.getBoundingClientRect = () => rectangle;
    const transform = new TransformHandler(
      { width: () => 100, height: () => 80 } as GameView,
      new EventBus(),
      canvas,
    );
    const segments = curvedPath(
      [
        { x: 20.5, y: 21.5 },
        { x: 28.5, y: 21.5 },
      ],
      () => true,
    );
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      stroke: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
    };
    const screen = (point: { x: number; y: number }) =>
      transform.worldToScreenCoordinates(new Cell(point.x, point.y));
    drawCommandArrow(
      ctx as unknown as CanvasRenderingContext2D,
      segments,
      screen,
      "army",
      "preview",
    );
    const first = ctx.moveTo.mock.calls[0];
    expect(first).toEqual(Object.values(screen(segments[0].from)));
    transform.override(5, 6, 4);
    rectangle = { left: 55, top: 70, width: 1200, height: 800 } as DOMRect;
    transform.updateCanvasBoundingRect();
    ctx.moveTo.mockClear();
    drawCommandArrow(
      ctx as unknown as CanvasRenderingContext2D,
      segments,
      screen,
      "army",
      "active",
    );
    expect(ctx.moveTo.mock.calls[0]).toEqual(
      Object.values(screen(segments[0].from)),
    );
    expect(ctx.moveTo.mock.calls[0]).not.toEqual(first);
    const arrowhead = ctx.moveTo.mock.calls[1];
    expect(arrowhead).toEqual(Object.values(screen(segments[0].to)));
    const roundtrip = transform.screenToWorldCoordinatesFloat(
      arrowhead[0],
      arrowhead[1],
    );
    expect(roundtrip).toEqual(segments[0].to);
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    transform.dispose();
  });
});
