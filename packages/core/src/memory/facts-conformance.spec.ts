/** MemoryStore against the Facts conformance suite (WP-146): the same cases the SQLite Facts must pass. */
import type { CompiledConfig } from '../schema/compile/contract';
import { createGeo } from '../geo';
import { featureAccess } from '../plan/access';
import { SIM_CONFIG_VERSION, createClock } from '../testing/ids';
import { describeFactsConformance, type FactsHarness } from '../testing/facts-conformance';
import { INVERSE_OF, SCHEMA } from '../testing/facts-conformance-kit';
import { MemoryStore } from './store';

/** The parts of a compiled config that fold and `featureAccess` read: fold types and the `inverse_of` relations. */
function config(): CompiledConfig {
  const types: { [type: string]: { relations: { [rel: string]: { inverse_of: string } } } } = {};
  for (const [name, of] of INVERSE_OF) {
    const [type, rel] = name.split('.') as [string, string];
    (types[type] ??= { relations: {} }).relations[rel] = { inverse_of: of };
  }
  return { foldTypes: SCHEMA.types, file: { types }, expressions: new Map() } as unknown as CompiledConfig;
}

function memory(): FactsHarness {
  const cfg = config();
  const store = new MemoryStore(cfg, createClock('2026-05-01T08:00:00Z'), createGeo(), SIM_CONFIG_VERSION);
  const access = featureAccess(store, cfg);
  return {
    facts: store,
    related: (id, relation) => access.related(id, relation),
    apply(observations, chunk = observations.length || 1) {
      for (let i = 0; i < observations.length; i += chunk)
        store.applyRecorded(observations.slice(i, i + chunk));
    },
    applyBy(actorId, observations) {
      const [first] = observations;
      if (first === undefined) return;
      store.append(
        first.runId,
        observations.map(({ featureId, property, result }) => ({ featureId, property, result })),
        actorId,
      );
    },
  };
}

describeFactsConformance('MemoryStore', memory);
