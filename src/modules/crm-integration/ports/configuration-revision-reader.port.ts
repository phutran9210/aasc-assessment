import type { EntityManager } from 'typeorm';

export const CONFIGURATION_REVISION_READER = Symbol('CONFIGURATION_REVISION_READER');

export type ConfigurationRevisionReader = {
  revisions(manager: EntityManager): Promise<Record<string, number>>;
};
