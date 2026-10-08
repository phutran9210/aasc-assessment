import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { LeadIdentityEntity } from '../entities/lead-identity.entity.js';

@Injectable()
export class LeadIdentityRepository {
  save(
    input: DeepPartial<LeadIdentityEntity>,
    manager: EntityManager,
  ): Promise<LeadIdentityEntity> {
    return manager.getRepository(LeadIdentityEntity).save(input);
  }

  findByValues(
    advertiserId: string,
    identities: Array<{ type: 'email' | 'phone'; value: string }>,
    manager: EntityManager,
  ): Promise<LeadIdentityEntity[]> {
    if (!identities.length) return Promise.resolve([]);
    return manager
      .getRepository(LeadIdentityEntity)
      .createQueryBuilder('identity')
      .where('identity.advertiserId = :advertiserId', { advertiserId })
      .andWhere(
        identities
          .map(
            (identity, index) =>
              `(identity.identityType = :type${index} AND identity.normalizedValue = :value${index})`,
          )
          .join(' OR '),
        Object.fromEntries(
          identities.flatMap((identity, index) => [
            [`type${index}`, identity.type],
            [`value${index}`, identity.value],
          ]),
        ),
      )
      .getMany();
  }
}
