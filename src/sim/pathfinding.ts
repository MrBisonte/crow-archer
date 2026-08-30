/** Path scheduling and field-of-view caching. Pure: solvers are injected. */

export type Waypoint = { x: number; y: number };

export type ComputePath = (fromX: number, fromY: number, toX: number, toY: number) => Waypoint[];

/** Marks every visible (col, row) via the callback. rot.js FOV in production, fakes in tests. */
export type ComputeFov = (col: number, row: number, mark: (x: number, y: number) => void) => void;

export interface PathAgent {
  x: number;
  y: number;
  state: string;
  /** Optional because rosters mix walkers with agents that never path — the
   * boss's bats ride in `crows` with no such field at all — and a scheduler
   * handed the whole roster must treat a missing route like an empty one. */
  path?: Waypoint[] | null;
  pathTimer: number;
  _pathQueued?: boolean;
}

/**
 * Caps how many path solves run per frame and staggers each agent's recompute
 * phase, so a mass-aggro event spreads its pathfinding across frames instead
 * of stalling one.
 */
export class PathScheduler<A extends PathAgent = PathAgent> {
  readonly budget: number;
  readonly interval: number;
  private compute: ComputePath;
  private queue: A[] = [];

  constructor(compute: ComputePath, opts: { budget?: number; interval?: number } = {}) {
    this.compute = compute;
    this.budget = opts.budget ?? 3;
    this.interval = opts.interval ?? 0.4;
  }

  /** Random first-recompute phase so identical agents don't solve in lockstep. */
  initialPhase(): number {
    return Math.random() * this.interval;
  }

  /** Idempotent per agent: one waiting slot each. */
  request(agent: A): void {
    if (!agent._pathQueued) {
      agent._pathQueued = true;
      this.queue.push(agent);
    }
  }

  /**
   * Serves up to `budget` waiting agents (FIFO, so none starves) toward
   * (tx, ty). Agents that stopped being aggro while queued are dropped.
   */
  serve(tx: number, ty: number): void {
    let served = 0;
    while (served < this.budget && this.queue.length > 0) {
      const agent = this.queue.shift();
      if (agent === undefined) break;
      agent._pathQueued = false;
      if (agent.state !== 'aggro') continue;
      agent.path = this.compute(agent.x, agent.y, tx, ty);
      agent.pathTimer = this.interval;
      served++;
    }
  }

  clear(): void {
    for (const a of this.queue) a._pathQueued = false;
    this.queue.length = 0;
  }

  /**
   * Drops any cached path that walks through tile (row, col), so its agent
   * re-solves instead of following a route that no longer exists.
   *
   * A cached route stays valid while ground only opens up, which is why
   * following waypoints without re-checking passability was right for as long
   * as it was: every terrain change this game had turned a tile to EMPTY or
   * ASH, and both are passable. Regrowth ended that. A sapling maturing into a
   * tree closes ground under routes already in flight, and the follower does
   * not consult the grid, so without this an agent walks through the new trunk
   * until its own recompute interval happens to expire.
   *
   * Takes the agents to check rather than tracking them, so the scheduler
   * still owns nothing but its queue. Returns how many were dropped, which is
   * what a test and a diagnostic both want.
   */
  invalidateThrough(agents: Iterable<A>, row: number, col: number, tileSize: number): number {
    let dropped = 0;
    for (const agent of agents) {
      const path = agent.path;
      // == on purpose: `undefined` (an agent that never paths, like the
      // boss's bats) is as routeless as `null`, and one field-less agent in
      // the roster must not take the frame loop down with it.
      if (path == null || path.length === 0) continue;
      if (!crossesTile(path, row, col, tileSize)) continue;
      agent.path = null;
      agent.pathTimer = 0;   // re-request on the next step rather than after the interval
      dropped++;
    }
    return dropped;
  }

  get pending(): number {
    return this.queue.length;
  }
}

/**
 * Does this path pass through the given tile?
 *
 * Waypoint centres only, not the segments between them. A* emits one waypoint
 * per tile step, so a route that enters a tile always has a waypoint in it,
 * and checking segments would cost more for no extra coverage.
 */
function crossesTile(path: Waypoint[], row: number, col: number, tileSize: number): boolean {
  for (const wp of path) {
    if (Math.floor(wp.y / tileSize) === row && Math.floor(wp.x / tileSize) === col) return true;
  }
  return false;
}

/**
 * Visible-tile cache backed by a flat Uint8Array indexed by row*cols+col, so
 * the per-agent visibility check is an array read with no string building.
 * Recomputes only when the tracked tile changes.
 */
export class FovMap {
  readonly rows: number;
  readonly cols: number;
  readonly tile: [number, number] = [-1, -1];
  private vis: Uint8Array;
  private compute: ComputeFov;

  constructor(rows: number, cols: number, compute: ComputeFov) {
    this.rows = rows;
    this.cols = cols;
    this.compute = compute;
    this.vis = new Uint8Array(rows * cols);
  }

  update(col: number, row: number): void {
    if (col === this.tile[0] && row === this.tile[1]) return;
    this.tile[0] = col;
    this.tile[1] = row;
    this.vis.fill(0);
    this.compute(col, row, (x, y) => {
      if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) this.vis[y * this.cols + x] = 1;
    });
  }

  isVisible(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    return this.vis[row * this.cols + col] === 1;
  }

  invalidate(): void {
    this.vis.fill(0);
    this.tile[0] = -1;
    this.tile[1] = -1;
  }
}
