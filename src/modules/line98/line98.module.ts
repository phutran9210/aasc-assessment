import { Line98Gateway } from '@modules/line98/gateways/line98.gateway.js';
import { Line98GameRepository } from '@modules/line98/repositories/line98-game.repository.js';
import { Line98Service } from '@modules/line98/services/line98.service.js';

import { Module } from '@nestjs/common';

@Module({
  providers: [Line98Gateway, Line98Service, Line98GameRepository],
})
export class Line98Module {}
