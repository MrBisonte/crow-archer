/**
 * Input model. One InputCommand per tick. Its shape is the network input
 * packet, so the single-player controller and the future remote packet are the
 * same type.
 */

/** Held-action bits packed into InputCommand.buttons. */
export const Button = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  FIRE: 1 << 4,
  SPECIAL: 1 << 5,
  SNIPE: 1 << 6,
} as const;

export type ButtonFlag = (typeof Button)[keyof typeof Button];

/** One tick of input. seq numbers the command for prediction reconciliation. */
export interface InputCommand {
  seq: number;
  buttons: number;
  aimAngle: number;
}

export const hasButton = (cmd: InputCommand, b: ButtonFlag): boolean => (cmd.buttons & b) !== 0;

/**
 * Raw per-tick input from the host environment (keyboard state, pointer angle).
 * Plain data, no DOM: the host builds it, the controller reads it.
 */
export interface RawInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  special: boolean;
  snipe: boolean;
  aimAngle: number;
}

/** Produces one InputCommand per tick. */
export interface Controller {
  sample(): InputCommand;
}

/** Builds commands from local keyboard and pointer input. */
export class LocalInput implements Controller {
  private seq = 0;
  private read: () => RawInput;

  constructor(read: () => RawInput) {
    this.read = read;
  }

  sample(): InputCommand {
    const r = this.read();
    let buttons = 0;
    if (r.up) buttons |= Button.UP;
    if (r.down) buttons |= Button.DOWN;
    if (r.left) buttons |= Button.LEFT;
    if (r.right) buttons |= Button.RIGHT;
    if (r.fire) buttons |= Button.FIRE;
    if (r.special) buttons |= Button.SPECIAL;
    if (r.snipe) buttons |= Button.SNIPE;
    return { seq: this.seq++, buttons, aimAngle: r.aimAngle };
  }
}

/**
 * Marker for server-driven entities (crows, boss). Produces no input on the
 * client; the server AI decides their moves.
 */
export class AIController implements Controller {
  sample(): InputCommand {
    return { seq: 0, buttons: 0, aimAngle: 0 };
  }
}

/**
 * Live-keyboard bookkeeping for the two DOM listeners in game.js, pure so
 * the awkward name cases are testable without a document.
 *
 * `keys` is the live "which names are down" map the game reads; `downAs`
 * remembers, per physical key (`event.code`), the name (`event.key`) it is
 * currently down under. `event.key` is what the key *produces*, so it
 * depends on the modifiers held at that moment, and the matching keyup can
 * report a different name — press a key with shift down, let shift go
 * first, and the release arrives under the other name. Whatever the map
 * was keyed by has to be recoverable from the hardware, or that entry
 * stays true forever: held against its own opposite it cancels that whole
 * axis, and the character stops answering up and down while left and right
 * still work.
 */
export function noteKeyDown(
  keys: Record<string, boolean>,
  downAs: Record<string, string>,
  code: string,
  key: string,
): void {
  // A held key that repeats under a new name (shift came down mid-hold,
  // CapsLock toggled) is still one physical key: release the name it went
  // down under before remembering the new one, or that first entry is
  // orphaned — the slot forgets it, so no keyup can ever clear it. W held
  // across a wizard blink was exactly that: down as 'w', repeating as 'W',
  // released as 'W', and the orphaned 'w' jammed the up axis for the rest
  // of the run.
  const before = downAs[code];
  if (before !== undefined && before !== key) keys[before] = false;
  keys[key] = true;
  downAs[code] = key;
}

/**
 * Clears both the name the release reports and the name the key went down
 * under, and returns the latter for release hooks keyed by name (the snipe
 * key, the F charge).
 */
export function noteKeyUp(
  keys: Record<string, boolean>,
  downAs: Record<string, string>,
  code: string,
  key: string,
): string | undefined {
  keys[key] = false;
  const wentDownAs = downAs[code];
  if (wentDownAs !== undefined) {
    keys[wentDownAs] = false;
    delete downAs[code];
  }
  return wentDownAs;
}
