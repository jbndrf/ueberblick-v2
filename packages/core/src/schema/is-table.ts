import type { FeatureType } from './feature-type';

/**
 * A table (Tabelle) is a feature type without geometry and without a process (A-030). The one definition: the admin's
 * Tabellen pages and the builder's reference picker both read it here (R1).
 */
export const isTable = (def: Pick<FeatureType, 'geometry' | 'process'>): boolean =>
  def.geometry === undefined && def.process === undefined;
