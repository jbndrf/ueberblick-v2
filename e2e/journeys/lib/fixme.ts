/** The details of a `test.fixme` journey: the reason line Playwright prints, "waits for the port of <area>". */
export function waitsFor(area: string): { annotation: { type: string; description: string } } {
  return { annotation: { type: 'fixme', description: `waits for the port of ${area}` } };
}
