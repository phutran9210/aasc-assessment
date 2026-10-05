import { ContactService } from '@modules/contact/index.js';
import { JotformApiService } from '@modules/jotform/services/jotform-api.service.js';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import request from 'supertest';

import { AppModule } from '../src/app.module.js';

const SECRET = 'test-webhook-secret-0123456789';
const FORM_ID = '252770000000001';
const WEBHOOK = `/jotform/webhook?secret=${SECRET}`;

const submission = (id: string, email = 'an@example.com') => ({
  id,
  form_id: FORM_ID,
  answers: {
    '3': { order: '1', type: 'control_fullname', answer: { first: 'An', last: 'Nguyễn' } },
    '4': { order: '2', type: 'control_phone', answer: { full: '0901234567' } },
    '5': { order: '3', type: 'control_email', answer: email },
  },
});

describe('Jotform webhook (e2e)', () => {
  const jotformApi = { getSubmission: jest.fn(), listSubmissions: jest.fn() };
  const contacts = { create: jest.fn() };
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JotformApiService)
      .useValue(jotformApi)
      .overrideProvider(ContactService)
      .useValue(contacts)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.resetAllMocks());

  it('should refuse a webhook without the secret', async () => {
    await request(app.getHttpServer())
      .post('/jotform/webhook')
      .field('submissionID', '7001')
      .expect(401);
    expect(jotformApi.getSubmission).not.toHaveBeenCalled();
  });

  it('should answer 400 when the webhook carries no submissionID', async () => {
    await request(app.getHttpServer()).post(WEBHOOK).field('formID', FORM_ID).expect(400);
  });

  it('should create one contact from a multipart webhook and ignore the repeat', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('7002'));
    contacts.create.mockResolvedValue({ id: '42' });
    const send = () =>
      request(app.getHttpServer())
        .post(WEBHOOK)
        .field('formID', FORM_ID)
        .field('submissionID', '7002')
        .field('rawRequest', '{"q3_name":{"first":"Ignored"}}');

    const first = await send().expect(200);
    expect(first.body).toEqual({ status: 'synced', submissionId: '7002', contactId: '42' });

    const second = await send().expect(200);
    expect(second.body).toEqual({ status: 'duplicate', submissionId: '7002', contactId: '42' });

    expect(contacts.create).toHaveBeenCalledTimes(1);
    expect(contacts.create).toHaveBeenCalledWith({
      name: 'An Nguyễn',
      phone: '0901234567',
      email: 'an@example.com',
    });
  });

  it('should accept a JSON webhook body as well', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('7003'));
    contacts.create.mockResolvedValue({ id: '43' });

    await request(app.getHttpServer())
      .post(WEBHOOK)
      .send({ formID: FORM_ID, submissionID: '7003' })
      .expect(200);
  });

  it('should answer 422 with the invalid fields and allow a later retry', async () => {
    jotformApi.getSubmission.mockResolvedValueOnce(submission('7004', 'not-an-email'));
    const send = () => request(app.getHttpServer()).post(WEBHOOK).field('submissionID', '7004');

    const invalid = await send().expect(422);
    expect(invalid.body.message).toEqual(['Email không hợp lệ']);
    expect(contacts.create).not.toHaveBeenCalled();

    jotformApi.getSubmission.mockResolvedValueOnce(submission('7004'));
    contacts.create.mockResolvedValue({ id: '44' });
    await send().expect(200);
  });

  it('should refuse a webhook for another form', async () => {
    await request(app.getHttpServer())
      .post(WEBHOOK)
      .field('formID', '999')
      .field('submissionID', '7005')
      .expect(400);
    expect(jotformApi.getSubmission).not.toHaveBeenCalled();
  });

  it('should require a JWT for the manual sync', async () => {
    await request(app.getHttpServer()).post('/jotform/sync').expect(401);
  });
});
