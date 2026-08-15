/**
 * Moving a body through terrain.
 *
 * The two axes are tried separately. Doing them together means a body that
 * clips a corner stops dead, which reads as catching on nothing; doing them
 * apart lets it keep the component that was fine and slide along the wall. That
 * is the difference between terrain you move through and terrain you fight.
 *
 * A body is a circle, so its four cardinal edge points are tested rather than
 * its centre. Testing the centre alone lets half a player stand inside rock.
 */

import type { Terrain } from './arena-map';

/** Can a circle of this radius sit here without overlapping solid ground? */
export function bodyFits(terrain: Terrain, x: number, y: number, radius: number): boolean {
  return (
    terrain.walkable(x - radius, y) &&
    terrain.walkable(x + radius, y) &&
    terrain.walkable(x, y - radius) &&
    terrain.walkable(x, y + radius)
  );
}

/**
 * Moves a body by a step, keeping whichever axes it can.
 *
 * Returns where it ended up. A step into a wall on both axes leaves it exactly
 * where it was, which is a stop rather than a stutter.
 */
export function slide(
  terrain: Terrain,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (dx !== 0 && bodyFits(terrain, x + dx, ny, radius)) nx = x + dx;
  if (dy !== 0 && bodyFits(terrain, nx, y + dy, radius)) ny = y + dy;
  return { x: nx, y: ny };
}
