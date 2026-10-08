import { HttpExceptionFilter } from '@common/filters/index.js';
import { LoggingInterceptor } from '@common/interceptors/index.js';
import { AppConfigModule } from '@config/index.js';
import { DatabaseModule } from '@core/database/index.js';
import { HealthModule } from '@core/health/index.js';
import { AuthModule } from '@modules/auth/index.js';
import { BitrixModule } from '@modules/bitrix/index.js';
import { CaroModule } from '@modules/caro/index.js';
import { ContactModule } from '@modules/contact/index.js';
import { JotformModule } from '@modules/jotform/index.js';
import { LeadSyncModule } from '@modules/lead-sync/index.js';
import { Line98Module } from '@modules/line98/index.js';
import { TaskModule } from '@modules/task/index.js';
import { UserModule } from '@modules/user/index.js';

import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

/**
 * Root module. Global pipe/filter/interceptor are registered here (not in `main.ts`) so that
 * e2e tests booting `AppModule` get exactly the same request pipeline as production.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    BitrixModule,
    ContactModule,
    JotformModule,
    LeadSyncModule,
    UserModule,
    TaskModule,
    Line98Module,
    CaroModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      // whitelist + forbidNonWhitelisted: unknown body/query fields are rejected with 400.
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
