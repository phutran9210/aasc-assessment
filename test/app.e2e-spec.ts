import type { NestExpressApplication } from '@nestjs/platform-express';

import request from 'supertest';

import { createTestApp } from './utils/create-test-app.js';

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 with database up when the app is running', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        database: 'up',
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      });
    });
  });

  describe('error format', () => {
    it('should return the unified error body when the route does not exist', async () => {
      const response = await request(app.getHttpServer()).get('/not-a-route').expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Cannot GET /not-a-route',
        path: '/not-a-route',
        timestamp: expect.any(String),
      });
    });

    it('should leave the query string out of the error path when the url carries one', async () => {
      const response = await request(app.getHttpServer()).get('/nope?code=secret').expect(404);

      expect(response.body.path).toBe('/nope');
      expect(response.body.message).toBe('Cannot GET /nope');
    });

    it('should return the unified error body when the JSON body is malformed', async () => {
      const response = await request(app.getHttpServer())
        .post('/health')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .expect(400);

      expect(response.body).toEqual(
        expect.objectContaining({ statusCode: 400, error: 'Bad Request', path: '/health' }),
      );
    });
  });

  describe('security headers', () => {
    it('should send helmet and CORS headers when a browser calls the API', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://client.example.com')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('GET /docs', () => {
    it('should serve Swagger UI when swagger is enabled', async () => {
      const response = await request(app.getHttpServer()).get('/docs').expect(200);

      expect(response.text).toContain('swagger-ui');
    });
  });

  describe('GET /docs-json', () => {
    it('should expose the OpenAPI document including /health when Swagger is set up', async () => {
      const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

      expect(response.body.paths).toHaveProperty('/health');
      expect(response.body.components.schemas).toHaveProperty('HealthResponseDto');
    });
  });
});
