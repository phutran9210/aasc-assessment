import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from './utils/create-test-app.js';

describe('Bitrix and Contact endpoints (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => app.close());

  it('should reject malformed install callback without persisting tokens', async () => {
    await request(app.getHttpServer())
      .post('/install')
      .send({ event: 'ONAPPINSTALL', auth: {} })
      .expect(400);
  });

  it('should return 401 for contacts without JWT', async () => {
    await request(app.getHttpServer()).get('/contacts').expect(401);
  });
});
