import type {
  BitrixInstallationSnapshot,
  RefreshLease,
} from '../types/bitrix-installation-snapshot.type.js';
import type { BitrixTokenSet } from '../types/index.js';

export const BITRIX_INSTALLATION_STORE = Symbol('BITRIX_INSTALLATION_STORE');

export type BitrixInstallationStore = {
  findCurrent(): Promise<BitrixInstallationSnapshot | null>;
  saveTokens(
    input: BitrixTokenSet,
    options?: { allowPortalChange?: boolean },
  ): Promise<BitrixInstallationSnapshot>;
  acquireRefreshLock(
    installationId: string,
    expectedRefreshToken: string,
    leaseMs: number,
  ): Promise<RefreshLease | null>;
  releaseRefreshLock(lease: RefreshLease): Promise<void>;
  replaceTokens(
    lease: RefreshLease,
    expectedRefreshToken: string,
    input: BitrixTokenSet,
  ): Promise<boolean>;
};
