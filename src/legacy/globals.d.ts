/**
 * The browser-global surface `game.js` attaches at boot.
 *
 * None of this is imported by anything: it exists to be typed into a console
 * by a person, or read by the harness in `tests.html`. That is exactly why it
 * needs declaring. An assignment to `window` is invisible to every other check
 * in the build, so without this file the console verbs are unverified code
 * that only runs when a human happens to type them, which is how `knights()`
 * shipped calling a function that did not exist.
 */
export {};

declare global {
  interface Window {
    /** Safari's prefixed constructor, still the only one on older WebKit. */
    webkitAudioContext?: typeof AudioContext;
    /** Pure classes lifted out for the harness in `tests.html`. */
    CrowArcherInternals: unknown;
    /** The dev-hook surface the headless tests and the console both drive. */
    __game: unknown;
    /** Stands one of every candidate mount across the map, spaced out. */
    knights: () => unknown;
    /** Jumps straight into a siege at `wave`, skipping the ones before it. */
    siege: (wave?: number) => unknown;
    /** Takes `n` HP off every guard, for watching the retinue thin out. */
    hurt: (n?: number) => unknown;
    /** Takes `hp` off both towers, for watching one fall. */
    crack: (hp?: number) => unknown;
    /** The retinue as readable lines: rank marker, kind, HP. */
    retinue: () => string[];
  }
}
