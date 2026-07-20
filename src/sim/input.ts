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
