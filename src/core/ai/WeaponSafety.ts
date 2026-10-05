import { Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

/** Exact, fixed-size blast check against public ownership at selection time. */
export function safeMIRVWarhead(
  game: Game,
  player: Player,
  tile: TileRef,
): boolean {
  const radius = game.config().nukeMagnitudes(UnitType.MIRVWarhead).outer;
  const cx = game.x(tile),
    cy = game.y(tile);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (
        dx * dx + dy * dy > radius * radius ||
        !game.isValidCoord(cx + dx, cy + dy)
      )
        continue;
      const nearby = game.ref(cx + dx, cy + dy);
      if (!game.hasOwner(nearby)) continue;
      const owner = game.owner(nearby);
      if (owner === player || (owner.isPlayer() && player.isFriendly(owner)))
        return false;
    }
  }
  return true;
}
