import { CaroController } from '@modules/caro/controllers/caro.controller.js';
import { CaroGateway } from '@modules/caro/gateways/caro.gateway.js';
import { CaroMatchRepository } from '@modules/caro/repositories/caro-match.repository.js';
import { CaroMatchService } from '@modules/caro/services/caro-match.service.js';
import { UserModule } from '@modules/user/index.js';

import { Module } from '@nestjs/common';

@Module({
  imports: [UserModule],
  controllers: [CaroController],
  providers: [CaroGateway, CaroMatchService, CaroMatchRepository],
})
export class CaroModule {}
