/** The one decision of what the device keeps after a completed sync (WP-669, R1): live versions plus those queued runs name. */
export function keepSet(live: Iterable<number>, queued: Iterable<number>): ReadonlySet<number> {
  return new Set([...live, ...queued]);
}
