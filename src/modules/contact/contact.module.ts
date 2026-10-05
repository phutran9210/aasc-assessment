import { BitrixModule } from '@modules/bitrix/index.js';

import { Module } from '@nestjs/common';

import { ContactController } from './controllers/contact.controller.js';
import { ContactService } from './services/contact.service.js';

@Module({
  imports: [BitrixModule],
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
