import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from '../dto/index.js';

type DtoClass<T> = new () => T;

/** Runs the same transform + validate steps as the global ValidationPipe. */
async function messagesOf<T extends object>(dto: DtoClass<T>, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('CreateTaskDto', () => {
  it('should accept a body when only the title is given', async () => {
    expect(await messagesOf(CreateTaskDto, { title: 'Viết báo cáo' })).toEqual([]);
  });

  it('should trim the title and description when they have surrounding spaces', () => {
    const dto = plainToInstance(CreateTaskDto, { title: '  Viết báo cáo  ', description: ' a ' });

    expect(dto.title).toBe('Viết báo cáo');
    expect(dto.description).toBe('a');
  });

  it.each([
    ['is missing', {}],
    ['is an empty string', { title: '' }],
    ['contains only spaces', { title: '   ' }],
  ])('should report that title is required when it %s', async (_case, body) => {
    expect(await messagesOf(CreateTaskDto, body)).toContain('title không được để trống');
  });

  it.each([
    ['a number', { title: 123 }],
    ['null', { title: null }],
  ])('should report that title must be a string when it is %s', async (_case, body) => {
    expect(await messagesOf(CreateTaskDto, body)).toContain('title phải là chuỗi');
  });

  it('should accept a title of exactly 255 characters and reject 256', async () => {
    expect(await messagesOf(CreateTaskDto, { title: 'a'.repeat(255) })).toEqual([]);
    expect(await messagesOf(CreateTaskDto, { title: 'a'.repeat(256) })).toEqual([
      'title không được vượt quá 255 ký tự',
    ]);
  });

  it('should reject a description longer than 2000 characters', async () => {
    const body = { title: 'ok', description: 'a'.repeat(2001) };

    expect(await messagesOf(CreateTaskDto, body)).toEqual([
      'description không được vượt quá 2000 ký tự',
    ]);
  });

  it.each(['To Do', 'In Progress', 'Done'])('should accept status "%s"', async (status) => {
    expect(await messagesOf(CreateTaskDto, { title: 'ok', status })).toEqual([]);
  });

  it.each(['done', 'TODO', 'Cancelled', '', 1])('should reject status %p', async (status) => {
    expect(await messagesOf(CreateTaskDto, { title: 'ok', status })).toEqual([
      'status phải là một trong: To Do, In Progress, Done',
    ]);
  });
});

describe('UpdateTaskDto', () => {
  it('should accept an empty body when nothing has to change', async () => {
    expect(await messagesOf(UpdateTaskDto, {})).toEqual([]);
  });

  it('should accept null description when the client clears it', async () => {
    expect(await messagesOf(UpdateTaskDto, { description: null })).toEqual([]);
  });

  it('should reject null title when the client sends it explicitly', async () => {
    expect(await messagesOf(UpdateTaskDto, { title: null })).toContain('title phải là chuỗi');
  });

  it('should reject a blank title when the client sends only spaces', async () => {
    expect(await messagesOf(UpdateTaskDto, { title: '  ' })).toEqual(['title không được để trống']);
  });

  it('should reject null status when the client sends it explicitly', async () => {
    expect(await messagesOf(UpdateTaskDto, { status: null })).toEqual([
      'status phải là một trong: To Do, In Progress, Done',
    ]);
  });
});

describe('TaskQueryDto', () => {
  it('should keep pagination defaults and accept a valid status filter', async () => {
    const dto = plainToInstance(TaskQueryDto, { status: 'Done' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toEqual({ page: 1, limit: 20, status: 'Done' });
  });

  it('should reject an unknown status filter', async () => {
    expect(await messagesOf(TaskQueryDto, { status: 'Archived' })).toEqual([
      'status phải là một trong: To Do, In Progress, Done',
    ]);
  });
});
