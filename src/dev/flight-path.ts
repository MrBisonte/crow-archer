/**
 * The one home for the flight recorder's endpoint path. Its two sides —
 * the page that POSTs (flight-recorder.ts) and the dev-server route that
 * appends (flight-sink.ts) — both import this rather than each stating the
 * literal, and it lives alone because the sink pulls in node:fs, which the
 * client bundle must never see.
 */
export const FLIGHT_PATH = '/__flight';
