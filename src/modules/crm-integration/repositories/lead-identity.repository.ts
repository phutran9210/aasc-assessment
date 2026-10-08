import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { LeadIdentityEntity } from '../entities/lead-identity.entity.js';

@Injectable()
export class LeadIdentityRepository {
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
