import { describe, expect, it } from "vitest";
import { UsernameSchema } from "../src/core/Schemas";
import {
  climateIndex,
  factionForPlayer,
  factionsForCountry,
  modernFaction,
  modernFactionPlayerId,
  modernFactions,
  modernRegions,
} from "../src/core/game/ModernRegions";
import { modernWorld } from "../src/core/game/ModernWorld";

function ownership(
  runs: number[][],
  width: number,
  height: number,
): Uint16Array {
  const result = new Uint16Array(width * height);
  for (const [index, start, length] of runs) {
    for (let tile = start; tile < start + length; tile++) {
      if (result[tile] !== 0) throw new Error(`Duplicate tile ${tile}`);
      result[tile] = index;
    }
  }
  return result;
}

describe("modern regions v2 immutable scenario data", () => {
  const parentOwner = ownership(
    modernWorld.runs,
    modernWorld.width,
    modernWorld.height,
  );
  const owner = ownership(
    modernRegions.runs,
    modernRegions.width,
    modernRegions.height,
  );
  const parentIndices = new Map(
    modernWorld.countries.map((country) => [country.id, country.index]),
  );

  it("keeps v1 immutable and assigns every original parent tile once", () => {
    expect(modernRegions.version).toBe(2);
    expect(modernRegions.scenarioId).toBe("modern-regions-v2");
    expect(modernRegions.parentScenarioHash).toBe(modernWorld.hash);
    expect(modernRegions.terrainHash).toBe(modernWorld.terrainHash);
    expect(modernRegions.hash).not.toBe(modernWorld.hash);
    let assigned = 0;
    for (let tile = 0; tile < owner.length; tile++) {
      if (owner[tile] === 0) {
        if (parentOwner[tile] !== 0)
          throw new Error(`Missing parent tile ${tile}`);
      } else {
        assigned++;
        const faction = modernFactions[owner[tile] - 1];
        if (parentOwner[tile] !== parentIndices.get(faction.parentCountryId)) {
          throw new Error(`Faction escaped its parent at ${tile}`);
        }
      }
    }
    expect(assigned).toBe(491821);
  });

  it("splits every controller exceeding the same real geodesic threshold", () => {
    const parents = new Set(modernFactions.map((f) => f.parentCountryId));
    expect(parents.size).toBe(modernWorld.countries.length);
    for (const parentId of parents) {
      const factions = factionsForCountry(parentId);
      const parentArea = factions[0].parentAreaKm2;
      if (parentArea > 1200000) {
        expect(factions.length, parentId).toBeGreaterThan(1);
        for (const faction of factions) {
          expect(faction.isSplit).toBe(true);
          expect(faction.id).not.toBe(parentId);
          expect(faction.adminUnits.every((u) => u.level >= 1)).toBe(true);
        }
      } else {
        expect(factions).toHaveLength(1);
        expect(factions[0].id).toBe(parentId);
        expect(factions[0].tiles).toBe(
          modernWorld.countries.find((country) => country.id === parentId)!
            .tiles,
        );
      }
    }
  });

  it("discloses every out-of-range administrative region instead of hiding it", () => {
    for (const faction of modernFactions.filter((f) => f.isSplit)) {
      const inRange = faction.areaKm2 >= 800000 && faction.areaKm2 <= 1200000;
      if (inRange) {
        expect(faction.areaException).toBeNull();
      } else {
        expect(faction.areaException?.reason.length).toBeGreaterThan(0);
        expect(faction.areaException?.correction).toContain("identical N0");
        expect(
          modernRegions.exceptions.find((e) => e.factionId === faction.id)
            ?.areaKm2,
        ).toBe(faction.areaKm2);
      }
    }
  });

  it("gives independent stable controller IDs and legal owned regional centres", () => {
    const controllers = new Set<string>();
    for (const faction of modernFactions) {
      const id = modernFactionPlayerId(faction);
      expect(controllers.has(id)).toBe(false);
      controllers.add(id);
      expect(factionForPlayer(id)).toBe(faction);
      expect(modernFaction(faction.id)).toBe(faction);
      const [x, y] = faction.capital;
      expect(owner[y * modernRegions.width + x]).toBe(faction.index);
      expect(faction.tiles).toBeGreaterThan(0);
      expect(faction.capitalName.length).toBeGreaterThan(0);
      expect(UsernameSchema.safeParse(faction.gameName).success).toBe(true);
    }
    expect(factionForPlayer("world001")).toBeUndefined();
    expect(() => modernFaction("RUS-does-not-exist")).toThrow();
  });

  it("conserves the geographic parent union after source coastline alignment", () => {
    expect(modernRegions.administrativeCoverage).toHaveLength(24);
    for (const coverage of modernRegions.administrativeCoverage) {
      expect(
        coverage.unassignedGeometryKm2,
        coverage.parentCountryId,
      ).toBeLessThanOrEqual(0.01);
      expect(coverage.coastlineAlignmentKm2).toBeGreaterThanOrEqual(0);
    }
    const canadian = modernRegions.administrativeCoverage.find(
      (entry) => entry.parentCountryId === "CAN",
    )!;
    expect(canadian.refinedAdmin1Ids.length).toBeGreaterThan(0);
    expect(
      factionsForCountry("CAN").every((f) => f.areaException === null),
    ).toBe(true);
  });

  it("uses regional measured climate with one or two initial adaptations", () => {
    const climate = ownership(
      modernRegions.climateRuns,
      modernRegions.width,
      modernRegions.height,
    );
    for (let tile = 0; tile < climate.length; tile++) {
      if (owner[tile] === 0 && climate[tile] !== 0)
        throw new Error(`Climate assigned to sea ${tile}`);
      if (owner[tile] !== 0 && (climate[tile] < 1 || climate[tile] > 5))
        throw new Error(`Missing climate ${tile}`);
    }
    for (const faction of modernFactions) {
      expect(
        Object.values(faction.climateDistribution).reduce(
          (total, value) => total + value,
          0,
        ),
      ).toBe(10000);
      expect(faction.adaptedClimates.length).toBeGreaterThanOrEqual(1);
      expect(faction.adaptedClimates.length).toBeLessThanOrEqual(2);
    }
    expect(climateIndex("arid")).toBe(1);
    expect(climateIndex("polar")).toBe(5);
  });

  it("assigns each named actual major port to exactly one independent faction", () => {
    const ids = new Set<string>();
    const tiles = new Set<string>();
    expect(modernRegions.ports.length).toBeGreaterThan(50);
    for (const port of modernRegions.ports) {
      expect(ids.has(port.portId)).toBe(false);
      expect(tiles.has(port.tile.join(","))).toBe(false);
      ids.add(port.portId);
      tiles.add(port.tile.join(","));
      const faction = modernFaction(port.factionId);
      const [x, y] = port.tile;
      expect(owner[y * modernRegions.width + x]).toBe(faction.index);
      expect(faction.majorPortIds).toContain(port.portId);
      expect(port.parentCountryId).toBe(faction.parentCountryId);
      expect(port.initialLevel).toBe(0);
      expect(port.lon).toBeGreaterThanOrEqual(-180);
      expect(port.lon).toBeLessThanOrEqual(180);
      expect(port.lat).toBeGreaterThanOrEqual(-90);
      expect(port.lat).toBeLessThanOrEqual(90);
    }
  });
});
