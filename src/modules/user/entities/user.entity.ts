import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import { USER_CONSTRAINTS } from '../constants/index.js';

@Entity(TABLE_NAMES.USER)
@Index('uq_user_username', ['username'], { unique: true })
// SQLite treats NULLs as distinct, so many users may have no email.
@Index('uq_user_email', ['email'], { unique: true })
export class User extends BaseEntity {
  /** Always stored in lower case, which makes the unique index case-insensitive. */
  @Column({ type: 'varchar', length: USER_CONSTRAINTS.USERNAME.MAX_LENGTH })
  username: string;

  /** bcrypt hash. Never returned by any API. */
  @Column({ type: 'varchar', length: USER_CONSTRAINTS.PASSWORD_HASH.MAX_LENGTH })
  passwordHash: string;

  @Column({ type: 'varchar', length: USER_CONSTRAINTS.EMAIL.MAX_LENGTH, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: USER_CONSTRAINTS.NICKNAME.MAX_LENGTH, nullable: true })
  nickname: string | null;
}
