import { ConfigurationHeadEntity } from '../../../modules/crm-integration/entities/configuration-head.entity.js';
import { BitrixInstallationEntity } from '../../../modules/crm-integration/entities/bitrix-installation.entity.js';
import { ConfigurationEntity } from '../../../modules/crm-integration/entities/configuration.entity.js';
import { IntegrationUserEntity } from '../../../modules/integration-auth/entities/integration-user.entity.js';

export const TIKTOK_ENTITIES = [
  IntegrationUserEntity,
  BitrixInstallationEntity,
  ConfigurationEntity,
  ConfigurationHeadEntity,
] as const;
