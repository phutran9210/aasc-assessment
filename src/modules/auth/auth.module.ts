import { authConfig } from '@config/index.js';
import type { AuthConfig } from '@config/index.js';
import { AuthController } from '@modules/auth/controllers/auth.controller.js';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import { AuthService } from '@modules/auth/services/auth.service.js';
import { UserModule } from '@modules/user/index.js';

import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * Global so that any module can use `JwtAuthGuard` (HTTP) or `AuthService.verifyToken`
 * (WebSocket handshake) without importing AuthModule and creating import cycles.
 */
@Global()
@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (config: AuthConfig) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.jwtExpiresInSeconds },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
