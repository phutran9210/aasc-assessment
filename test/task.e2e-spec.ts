import { performance } from 'node:perf_hooks';

import type { NestExpressApplication } from '@nestjs/platform-express';

import request from 'supertest';
import { DataSource } from 'typeorm';

import { Task } from '../src/modules/task/entities/task.entity.js';
import { createTestApp } from './utils/create-test-app.js';

const UNKNOWN_ID = '0199a1b2-c3d4-7e5f-8a6b-0123456789ab';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Tasks (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.getRepository(Task).clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /tasks', () => {
    it('should create a task with default status when only the title is sent', async () => {
      const response = await http().post('/tasks').send({ title: '  Viết báo cáo  ' }).expect(201);

      expect(response.body).toEqual({
        id: expect.stringMatching(UUID),
        title: 'Viết báo cáo',
        description: null,
        status: 'To Do',
        createdAt: expect.stringMatching(ISO_DATE),
        updatedAt: expect.stringMatching(ISO_DATE),
      });
    });

    it('should return 400 with Vietnamese messages when the body is invalid', async () => {
      const response = await http()
        .post('/tasks')
        .send({ title: '   ', status: 'Cancelled' })
        .expect(400);

      expect(response.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'title không được để trống',
          'status phải là một trong: To Do, In Progress, Done',
        ],
        path: '/tasks',
        timestamp: expect.stringMatching(ISO_DATE),
      });
    });

    it('should return 400 when the body contains a field that is not allowed', async () => {
      const response = await http()
        .post('/tasks')
        .send({ title: 'ok', id: UNKNOWN_ID, createdAt: '2000-01-01' })
        .expect(400);

      expect(response.body.message).toEqual([
        'property id should not exist',
        'property createdAt should not exist',
      ]);
    });
  });

  describe('GET /tasks', () => {
    it('should return an empty page when there are no tasks', async () => {
      const response = await http().get('/tasks').expect(200);

      expect(response.body).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('should paginate newest first and filter by status', async () => {
      await http().post('/tasks').send({ title: 'a', status: 'Done' }).expect(201);
      await http().post('/tasks').send({ title: 'b' }).expect(201);
      await http().post('/tasks').send({ title: 'c', status: 'Done' }).expect(201);

      const firstPage = await http().get('/tasks?page=1&limit=2').expect(200);
      const done = await http().get('/tasks').query({ status: 'Done' }).expect(200);

      expect(firstPage.body.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
      expect(firstPage.body.data.map((task: { title: string }) => task.title)).toEqual(['c', 'b']);
      expect(firstPage.body.data[0]).not.toHaveProperty('updatedAt');
      expect(done.body.meta.total).toBe(2);
      expect(done.body.data.map((task: { title: string }) => task.title)).toEqual(['c', 'a']);
    });

    it.each(['limit=0', 'limit=101', 'page=abc', 'status=Archived'])(
      'should return 400 when the query is "%s"',
      async (query) => {
        await http().get(`/tasks?${query}`).expect(400);
      },
    );
  });

  describe('GET /tasks/:id', () => {
    it('should return the task when it exists', async () => {
      const created = await http().post('/tasks').send({ title: 'Chi tiết', description: 'x' });

      const response = await http().get(`/tasks/${created.body.id}`).expect(200);

      expect(response.body).toEqual(created.body);
    });

    it('should return 404 with a Vietnamese message when the task does not exist', async () => {
      const response = await http().get(`/tasks/${UNKNOWN_ID}`).expect(404);

      expect(response.body.message).toBe('Task không tồn tại');
    });

    it('should return 400 when the id is not a UUID', async () => {
      const response = await http().get('/tasks/abc').expect(400);

      expect(response.body.message).toBe('id không hợp lệ (phải là UUID)');
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('should update only the fields that are sent', async () => {
      const created = await http().post('/tasks').send({ title: 'Cũ', description: 'giữ nguyên' });

      const response = await http()
        .patch(`/tasks/${created.body.id}`)
        .send({ status: 'In Progress' })
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          id: created.body.id,
          title: 'Cũ',
          description: 'giữ nguyên',
          status: 'In Progress',
          createdAt: created.body.createdAt,
        }),
      );
    });

    it('should clear the description when null is sent', async () => {
      const created = await http().post('/tasks').send({ title: 'x', description: 'xóa tôi' });

      const response = await http()
        .patch(`/tasks/${created.body.id}`)
        .send({ description: null })
        .expect(200);

      expect(response.body.description).toBeNull();
    });

    it('should return 400 and keep the task unchanged when the title is null', async () => {
      const created = await http().post('/tasks').send({ title: 'Giữ nguyên' });

      await http().patch(`/tasks/${created.body.id}`).send({ title: null }).expect(400);

      const after = await http().get(`/tasks/${created.body.id}`).expect(200);
      expect(after.body.title).toBe('Giữ nguyên');
    });

    it('should return 404 when the task does not exist', async () => {
      await http().patch(`/tasks/${UNKNOWN_ID}`).send({ title: 'x' }).expect(404);
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('should delete the task and return 204 with no body', async () => {
      const created = await http().post('/tasks').send({ title: 'Xóa' });

      const response = await http().delete(`/tasks/${created.body.id}`).expect(204);

      expect(response.text).toBe('');
      await http().get(`/tasks/${created.body.id}`).expect(404);
    });

    it('should return 404 when the task was already deleted', async () => {
      const created = await http().post('/tasks').send({ title: 'Xóa hai lần' });
      await http().delete(`/tasks/${created.body.id}`).expect(204);

      await http().delete(`/tasks/${created.body.id}`).expect(404);
    });
  });

  describe('performance', () => {
    it('should answer GET /tasks with 100 records in under 200ms', async () => {
      const tasks = Array.from({ length: 100 }, (_, index) => ({
        title: `Task ${index + 1}`,
        description: `Mô tả cho task ${index + 1}`,
      }));
      await dataSource.getRepository(Task).save(dataSource.getRepository(Task).create(tasks));
      await http().get('/tasks?limit=100').expect(200); // warm-up: first call pays JIT + cache

      const durations: number[] = [];
      for (let run = 0; run < 10; run += 1) {
        const startedAt = performance.now();
        const response = await http().get('/tasks?limit=100').expect(200);
        durations.push(performance.now() - startedAt);
        expect(response.body.data).toHaveLength(100);
      }

      const slowest = Math.max(...durations);
      const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
      console.info(
        `GET /tasks?limit=100 — avg ${average.toFixed(2)}ms, max ${slowest.toFixed(2)}ms (10 runs)`,
      );
      expect(slowest).toBeLessThan(200);
    });
  });

  describe('Swagger', () => {
    it('should document every task endpoint in the OpenAPI document', async () => {
      const response = await http().get('/docs-json').expect(200);

      expect(Object.keys(response.body.paths['/tasks']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(response.body.paths['/tasks/{id}']).sort()).toEqual([
        'delete',
        'get',
        'patch',
      ]);
    });
  });
});
