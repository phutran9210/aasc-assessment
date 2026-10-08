import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { validateTiktokEnv } from '../../../config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from './data-source.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: 'tiktok',
      useFactory: () => buildTiktokDataSource(validateTiktokEnv(process.env)).options,
    }),
  ],
  exports: [TypeOrmModule],
})
export class TiktokDatabaseModule {}
