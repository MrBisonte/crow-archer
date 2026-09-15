/**
 * Keeping the flight log inside the volume it lives on.
 *
 * One tab left open writes a record a second, about a kilobyte each, which is
 * 86 MB a day. A 1 GB volume is four fifths full in nine of those days, and a
 * full volume is the one failure the sink answers with a 500 rather than data.
 * So the sink stops before the disk does, and says so on the way past.
 *
 * Two mechanisms, and they are separate on purpose. The guard refuses a write
 * at STOP_AT and runs on every record, so it has to be cheap. The alerts run
 * once a day and tell somebody the volume is filling while there is still time
 * to act, which is what the lower bands are for.
 *
 * The decisions are pure functions here; the I/O is in index.ts.
 */

import { readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The fraction of the volume at which the sink stops accepting records.
 *
 * Not 100%: a disk with no room left takes the whole process down with it, and
 * the log is the thing being protected. Twenty percent is the headroom that
 * keeps the server answering while somebody empties it.
 */
export const STOP_AT = 0.80;

/** Where an alert fires on the way up. Ascending, and STOP_AT is one of them. */
export const ALERT_BANDS: readonly number[] = [0.60, 0.70, 0.80, 0.90];

export interface Usage {
  readonly usedFraction: number;
  readonly totalBytes: number;
  readonly freeBytes: number;
}

/** What the filesystem holding `dir` reports. */
export async function usage(dir: string): Promise<Usage> {
  const s = await statfs(dir);
  const totalBytes = s.blocks * s.bsize;
  // bavail, not bfree: the blocks a non-root process may actually have.
  const freeBytes = s.bavail * s.bsize;
  return {
    totalBytes,
    freeBytes,
    usedFraction: totalBytes === 0 ? 0 : 1 - freeBytes / totalBytes,
  };
}

/** Whether a record may be written at this usage. */
export function accepts(usedFraction: number): boolean {
  return usedFraction < STOP_AT;
}

/** The highest band this usage has reached, or null below all of them. */
export function currentBand(usedFraction: number): number | null {
  const reached = ALERT_BANDS.filter((b) => usedFraction >= b);
  return reached.length === 0 ? null : (reached[reached.length - 1] as number);
}

/**
 * The band to alert on, or null for silence.
 *
 * Silence is the answer in three cases and each one matters. Nothing crossed
 * since the last check, so a volume sitting at 61% for a month sends one mail
 * rather than thirty. A jump past several bands at once reports the highest
 * reached, not one mail per band. And usage that fell lowers the remembered
 * band on its own, because the caller stores currentBand after every check, so
 * a volume emptied and refilled reports the second climb too.
 */
export function bandToAlert(usedFraction: number, lastAlerted: number | null): number | null {
  const band = currentBand(usedFraction);
  if (band === null) return null;
  if (lastAlerted !== null && band <= lastAlerted) return null;
  return band;
}

/** The line a human reads in the alert. */
export function alertText(band: number, u: Usage, dir: string): string {
  const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return [
    `The crow-archer flight log volume is ${pct(u.usedFraction)} full.`,
    ``,
    `  mount   ${dir}`,
    `  used    ${pct(u.usedFraction)} of ${gb(u.totalBytes)}`,
    `  free    ${gb(u.freeBytes)}`,
    `  band    ${pct(band)}`,
    ``,
    u.usedFraction >= STOP_AT
      ? `The sink has STOPPED accepting records at ${pct(STOP_AT)} and answers 507.`
      : `The sink stops accepting records at ${pct(STOP_AT)}.`,
    ``,
    `Empty it with: fly ssh console -C "sh -c 'rm ${dir}/session-*.jsonl'"`,
    `Or pull the logs off first: fly ssh sftp get ${dir}/<file>`,
  ].join('\n');
}

//------------------------------------------------------------------------------
// The I/O around those decisions. Kept beside them rather than in index.ts,
// which stays the file that knows about sockets and routes and little else.
//------------------------------------------------------------------------------

/** Where the last alerted band is remembered, so a restart does not re-send. */
const MARK_FILE = '.storage-band';

/** How long a usage reading is reused for the write guard. */
const GUARD_TTL_MS = 30_000;

/** Somewhere an alert can be delivered. Injected, so a test needs no network. */
export type Notify = (subject: string, text: string) => Promise<void>;

/**
 * Refuses a write once the volume passes STOP_AT.
 *
 * The reading is cached, because this runs on every record and statfs is a
 * syscall per call otherwise. Thirty seconds is far inside the time it takes a
 * one-record-a-second writer to move the number.
 */
export function storageGuard(dir: string, ttlMs = GUARD_TTL_MS) {
  let checkedAt = 0;
  let lastFraction = 0;
  return async function acceptsNow(now = Date.now()): Promise<boolean> {
    if (now - checkedAt >= ttlMs) {
      try {
        lastFraction = (await usage(dir)).usedFraction;
      } catch {
        // An unreadable volume is not a reason to drop a record. The write
        // itself will fail if the disk is genuinely gone, and that path already
        // answers 500.
        lastFraction = 0;
      }
      checkedAt = now;
    }
    return accepts(lastFraction);
  };
}

/** The last band an alert went out for, or null when there is no mark yet. */
export async function readMark(dir: string): Promise<number | null> {
  try {
    const raw = await readFile(join(dir, MARK_FILE), 'utf8');
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;   // No mark yet, which is the state on a fresh volume.
  }
}

async function writeMark(dir: string, band: number | null): Promise<void> {
  const path = join(dir, MARK_FILE);
  if (band === null) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, String(band), 'utf8');
}

/**
 * One daily check: read the volume, alert if a new band was crossed, remember
 * where it stands. Returns the band it alerted on, for the caller's log.
 */
export async function checkStorage(dir: string, notify: Notify): Promise<number | null> {
  const u = await usage(dir);
  const mark = await readMark(dir);
  const band = bandToAlert(u.usedFraction, mark);
  await writeMark(dir, currentBand(u.usedFraction));
  if (band === null) return null;
  await notify(
    `crow-archer flight log volume ${(u.usedFraction * 100).toFixed(0)}% full`,
    alertText(band, u, dir),
  );
  return band;
}

/**
 * Posts an alert as JSON to whatever URL FLIGHT_ALERT_WEBHOOK names, addressed
 * to FLIGHT_ALERT_EMAIL.
 *
 * A webhook and not an email provider's own SDK: every provider has a different
 * payload, and this server has no business carrying a mail dependency for four
 * messages in the life of a volume. Point it at Resend, at a Zapier hook, at
 * anything that relays. With neither variable set it writes to stdout, which is
 * `fly logs`, and the deploy is not blocked on having somewhere to send mail.
 */
export function webhookNotifier(env: NodeJS.ProcessEnv = process.env): Notify {
  return async (subject, text) => {
    const url = env['FLIGHT_ALERT_WEBHOOK'];
    const to = env['FLIGHT_ALERT_EMAIL'];
    if (url === undefined || to === undefined) {
      process.stdout.write(`[flight-storage] ${subject}\n${text}\n`);
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, subject, text }),
      });
      if (!res.ok) process.stdout.write(`[flight-storage] alert POST ${res.status}\n`);
    } catch (err) {
      // An alert that cannot be delivered must not take the server with it.
      process.stdout.write(`[flight-storage] alert failed: ${String(err)}\n`);
    }
  };
}
