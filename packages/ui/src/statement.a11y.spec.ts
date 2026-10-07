// WP-554: the accessibility statement and the BITV self-check stay complete. No DOM needed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const de = read('static/accessibility/erklaerung-zur-barrierefreiheit.de.md');
const en = read('static/accessibility/accessibility-statement.en.md');
const check = read('docs/process/bitv-self-check.md');

const ownerFields = (s: string) => [...s.matchAll(/\{\{needs-owner:[^}]*\}\}/g)].map((m) => m[0]);

describe('accessibility statement (de and en)', () => {
  it('marks the contact, enforcement and approval fields needs-owner in both languages', () => {
    expect(ownerFields(de)).toHaveLength(ownerFields(en).length);
    expect(ownerFields(de).length).toBeGreaterThanOrEqual(8);
    for (const section of ['Barrieren melden', 'Durchsetzungsverfahren', 'Freigabe']) {
      expect(de).toContain(`## ${section}`);
    }
    for (const section of ['Report a barrier', 'Enforcement procedure', 'Approval']) {
      expect(en).toContain(`## ${section}`);
    }
  });

  it('has the same operator fields in both languages, and no field left half open', () => {
    const count = (s: string) => (s.match(/\{\{/g) ?? []).length;
    expect(count(de)).toBe(count(en));
    expect(de.match(/\{\{/g)?.length).toBe(de.match(/\}\}/g)?.length);
  });

  it('names each known failure of the self-check', () => {
    for (const criterion of ['2.4.2', '1.4.10']) {
      expect(de).toContain(criterion);
      expect(en).toContain(criterion);
    }
  });
});

describe('BITV self-check', () => {
  const rows = check.split('\n').filter((l) => /^\| \d\.\d\.\d/.test(l));

  it('gives every criterion row a result and evidence', () => {
    expect(rows.length).toBeGreaterThanOrEqual(37);
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      expect(cells[3], row).toMatch(/^(P|N\/A|\*\*F\*\*)$/);
      expect(cells[4]?.length, row).toBeGreaterThan(5);
    }
  });

  it('names a follow-up work package for every fail, and lists it in the follow-up table', () => {
    const fails = rows.filter((r) => r.includes('**F**'));
    for (const row of fails) {
      const wp = /WP-554\.\d/.exec(row)?.[0];
      expect(wp, row).toBeDefined();
      expect(check).toMatch(new RegExp(`\\| ${wp?.replace('.', '\\.')} \\|`));
    }
  });

  it('states the counts that the rows add up to', () => {
    const fail = rows.filter((r) => r.includes('**F**')).length;
    expect(check).toContain(`**${fail} fail**`);
  });
});
