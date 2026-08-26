/**
 * Showing a fixed-size canvas on a screen that is not that size.
 *
 * The canvas has one backing store, sized from the tile grid, and the game
 * draws into it in world pixels. What size it is *presented* at is a separate
 * question, and the page used to have no answer: with no CSS width the element
 * lays out at its buffer size, `body` centres it and hides the overflow, so a
 * viewport smaller than the buffer silently crops the map — the HUD first, then
 * whole columns, with no scrollbar to say so. Growing the grid makes that worse
 * on exactly the machines least able to take it.
 *
 * Scaling down rather than cropping is the whole of the fix, and it costs
 * nothing elsewhere: pointer input already converts through
 * `getBoundingClientRect()`, so aim follows the displayed size on its own.
 */

/** A width and a height in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The CSS size to show a `buffer`-sized canvas at so all of it fits `viewport`.
 *
 * Never scales up past 1: the art is authored at a fixed pixel size and
 * enlarging it past 1:1 makes every sprite soft for no gain in what is visible.
 * A viewport at least as big as the buffer therefore gets it pixel-perfect, and
 * everything smaller gets the whole map at a uniform reduction rather than part
 * of it at full size.
 *
 * A degenerate buffer or viewport returns the buffer unchanged, because the
 * alternative is a zero-sized canvas, and an invisible game hides its own cause.
 */
export function fitToViewport(buffer: Size, viewport: Size): Size {
  if (buffer.width <= 0 || buffer.height <= 0) return buffer;
  if (viewport.width <= 0 || viewport.height <= 0) return buffer;
  const scale = Math.min(1, viewport.width / buffer.width, viewport.height / buffer.height);
  return {
    width: Math.round(buffer.width * scale),
    height: Math.round(buffer.height * scale),
  };
}

/**
 * Keeps a canvas sized to fit the window, and returns a function that stops.
 *
 * Reads the buffer size on every pass rather than closing over it, so this can
 * be installed before the game has sized the canvas and still settle correctly
 * once it has.
 */
export function keepCanvasFitted(canvas: HTMLCanvasElement, view: Window): () => void {
  const apply = (): void => {
    const { width, height } = fitToViewport(
      { width: canvas.width, height: canvas.height },
      { width: view.innerWidth, height: view.innerHeight },
    );
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };
  apply();
  view.addEventListener('resize', apply);
  return () => view.removeEventListener('resize', apply);
}
