import { Colord, colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
extend([lchPlugin, labPlugin]);

// Full-severity Machado et al. (2009) protan/deutan/tritan observer matrices.
// Applied to linear RGB, then converted back to sRGB before comparing LAB.
const OBSERVERS = [
  [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
];

function observedColors(color: Colord): Colord[] {
  const { r, g, b } = color.toRgb();
  const linear = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const toSrgb = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  };
  return [
    color,
    ...OBSERVERS.map((m) =>
      colord({
        r: toSrgb(m[0] * linear[0] + m[1] * linear[1] + m[2] * linear[2]),
        g: toSrgb(m[3] * linear[0] + m[4] * linear[1] + m[5] * linear[2]),
        b: toSrgb(m[6] * linear[0] + m[7] * linear[1] + m[8] * linear[2]),
      }),
    ),
  ];
}

/** Shared by human, nation and enhanced tribe pools. Gray tribes are reserved. */
export class ColorRegistry {
  readonly colors: Colord[][] = [];
  private readonly hexes = new Set<string>();
  private readonly identities = new Map<string, Colord[]>();

  constructor(reserved: Colord[] = []) {
    reserved.forEach((color) => this.add(color));
  }
  has(color: Colord): boolean {
    return this.hexes.has(color.toHex());
  }
  add(color: Colord, id?: string): void {
    if (this.has(color)) return;
    const observed = observedColors(color);
    this.hexes.add(color.toHex());
    this.colors.push(observed);
    if (id !== undefined) this.identities.set(id, observed);
  }

  /** Only earlier assigned neighbors are known; fixed cap bounds startup work. */
  neighboringColors(ids: readonly string[]): Colord[][] {
    return ids.slice(0, 32).flatMap((id) => {
      const color = this.identities.get(id);
      return color ? [color] : [];
    });
  }
}

type Candidate = {
  color: Colord;
  observed: Colord[];
  nearest: number;
  checked: number;
};

/** Cached max-min allocation: no cutoff at 50 players and no palette recycling. */
export class ColorAllocator {
  private availableColors: Candidate[];
  private fallbackColors: Colord[];
  private assigned = new Map<string, Colord>();
  private generation = 0;

  constructor(
    colors: Colord[],
    fallback: Colord[],
    private registry = new ColorRegistry(),
    private allowReuse = false,
  ) {
    this.availableColors = this.candidates(colors);
    this.fallbackColors = this.unique([...colors, ...fallback]);
  }

  private unique(colors: Colord[]): Colord[] {
    return [...new Map(colors.map((c) => [c.toHex(), c])).values()];
  }

  private candidates(colors: Colord[]): Candidate[] {
    return this.unique(colors)
      .filter((c) => !this.registry.has(c))
      .map((color) => ({
        color,
        observed: observedColors(color),
        nearest: Infinity,
        checked: 0,
      }));
  }

  assignColor(id: string, neighborIds: readonly string[] = []): Colord {
    const assigned = this.assigned.get(id);
    if (assigned) return assigned;
    this.availableColors = this.availableColors.filter(
      (c) => !this.registry.has(c.color),
    );
    if (this.availableColors.length === 0) {
      if (this.allowReuse) {
        // Only the optional classic tribe palette intentionally shares colors.
        this.registry = new ColorRegistry();
      }
      this.availableColors = this.candidates(this.fallbackColors);
    }
    if (this.availableColors.length === 0) {
      // Fixed batch size bounds work; a golden-angle sweep extends the palette.
      const generated = Array.from({ length: 192 }, () => {
        const n = this.generation++;
        return colord({
          h: (n * 137.508) % 360,
          s: 58 + (n % 3) * 17,
          l: 42 + (n % 5) * 8,
        });
      });
      this.availableColors = this.candidates(generated);
    }
    let index = new PseudoRandom(simpleHash(id)).nextInt(
      0,
      this.availableColors.length,
    );
    let best = -1;
    let bestNeighborDistance = -1;
    const neighbors = this.registry.neighboringColors(neighborIds);
    for (let i = 0; i < this.availableColors.length; i++) {
      const candidate = this.availableColors[i];
      // Update only against additions since this candidate's last evaluation.
      for (
        ;
        candidate.checked < this.registry.colors.length;
        candidate.checked++
      ) {
        const other = this.registry.colors[candidate.checked];
        for (let observer = 0; observer < other.length; observer++) {
          candidate.nearest = Math.min(
            candidate.nearest,
            candidate.observed[observer].delta(other[observer]),
          );
        }
      }
      // Neighbor separation takes priority; global separation breaks ties.
      // Use the weakest of normal/protan/deutan/tritan observer distances.
      let neighborDistance = neighbors.length === 0 ? 0 : Infinity;
      for (const other of neighbors) {
        for (let observer = 0; observer < other.length; observer++) {
          neighborDistance = Math.min(
            neighborDistance,
            candidate.observed[observer].delta(other[observer]),
          );
        }
      }
      if (
        candidate.nearest !== Infinity &&
        (neighborDistance > bestNeighborDistance ||
          (neighborDistance === bestNeighborDistance &&
            candidate.nearest > best))
      ) {
        bestNeighborDistance = neighborDistance;
        best = candidate.nearest;
        index = i;
      }
    }
    const color = this.availableColors.splice(index, 1)[0].color;
    this.assigned.set(id, color);
    this.registry.add(color, id);
    return color;
  }
}

/** Kept for palette diagnostics and existing callers. */
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number {
  if (assignedColors.length === 0) throw new Error("No assigned colors");
  let best = -1;
  let index = 0;
  availableColors.forEach((color, i) => {
    const distance = Math.min(
      ...assignedColors.map((other) => color.delta(other)),
    );
    if (distance > best) {
      best = distance;
      index = i;
    }
  });
  return index;
}
