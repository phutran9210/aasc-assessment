import { Injectable } from '@nestjs/common';

@Injectable()
export class TiktokHealthService {
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
