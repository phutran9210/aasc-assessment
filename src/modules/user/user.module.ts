import { UserController } from '@modules/user/controllers/user.controller.js';
import { UserRepository } from '@modules/user/repositories/user.repository.js';
import { UserService } from '@modules/user/services/user.service.js';

import { Module } from '@nestjs/common';

/** `JwtAuthGuard` used by the controller is provided by the global AuthModule. */
@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
