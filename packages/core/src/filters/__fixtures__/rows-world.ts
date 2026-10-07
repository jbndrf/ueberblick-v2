/** The project for the new builder rows (WP-809): views-world plus a time, participant, reference and localized text property. */
import { compile } from '../../schema/compile';
import type { CompiledConfig } from '../../schema/compile/contract';
import { TemplateFileSchema } from '../../schema/file';
import { goldenAssets } from '../../testing/golden';
import { VIEWS_FILE } from './views-world';

export function rowsWorld(): CompiledConfig {
  const file = {
    ...VIEWS_FILE,
    types: {
      ...VIEWS_FILE.types,
      baum: {
        ...VIEWS_FILE.types.baum,
        properties: {
          ...VIEWS_FILE.types.baum.properties,
          uhrzeit: { type: 'time', label: { de: 'Uhrzeit' } },
          zustaendig: { type: 'participant', label: { de: 'Zuständig' } },
          bank: { type: 'reference', to: 'bank', label: { de: 'Bank' } },
          titel: { type: 'localized_text', label: { de: 'Titel' } },
        },
      },
    },
  };
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(`fixture does not compile: ${JSON.stringify(r.problems)}`);
  return r.config;
}
