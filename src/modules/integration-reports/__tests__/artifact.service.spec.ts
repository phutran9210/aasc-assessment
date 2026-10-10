import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import type { Actor } from '@modules/integration-auth/types/index.js';
import type { ReportJobEntity } from '../entities/report-job.entity.js';
import { ArtifactService } from '../services/artifact.service.js';

const id = '00000000-0000-4000-8000-000000000001';
const actor: Actor = {
  sub: id,
  sid: 'session',
  username: 'owner',
  roles: ['integration_operator'],
};

describe('ArtifactService', () => {
  let root: string;
  let job: ReportJobEntity;
  let service: ArtifactService;
  let jobs: { findById: jest.Mock };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aasc-artifact-'));
    job = {
      id,
      kind: 'export',
      requesterId: id,
      status: 'completed',
      artifactPath: null,
      artifactHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as ReportJobEntity;
    jobs = { findById: jest.fn(() => job) };
    service = new ArtifactService(root, jobs as never);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finalizes, checksums and opens an artifact for its requester', async () => {
    const temp = await service.createTemp('json');
    await writeFile(temp, '{"rows":[]}');
    const ref = await service.finalize(temp, id);
    job.artifactPath = ref.path;
    job.artifactHash = ref.hash;
    expect(ref.size).toBe(11);
    expect(await readFile(join(root, ref.path), 'utf8')).toBe('{"rows":[]}');

    const artifact = await service.openAuthorized(id, actor);
    expect(artifact.filename).toBe(`leads-${id}.json`);
    expect(artifact.contentType).toContain('application/json');
    expect(artifact.size).toBe(11);
    artifact.stream.destroy();
  });

  it('denies another requester and rejects a path outside the job directory', async () => {
    await expect(service.openAuthorized(id, { ...actor, sub: 'another-user' })).rejects.toThrow(
      ForbiddenException,
    );
    job.artifactPath = `exports/${id}/../../secret.json`;
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(ForbiddenException);
  });

  it('reports an expired artifact and safely discards only files in tmp', async () => {
    job.expiresAt = new Date(0);
    job.artifactPath = `exports/${id}/00000000-0000-4000-8000-000000000002.json`;
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(GoneException);
    const temp = await service.createTemp('csv');
    await writeFile(temp, 'partial');
    await service.discard(temp);
    await expect(readFile(temp)).rejects.toThrow();
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'keep');
    await service.discard(outside);
    expect(await readFile(outside, 'utf8')).toBe('keep');
  });

  it('opens a temporary artifact as a stream and unlinks it immediately', async () => {
    const temp = await service.createTemp('json');
    await writeFile(temp, 'temporary export');

    const opened = await service.openTemp(temp);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));

    expect(opened.size).toBe(16);
    expect(Buffer.concat(chunks).toString()).toBe('temporary export');
    await expect(readFile(temp)).rejects.toThrow();
  });

  it('rejects an invalid job id and skips a missing retention directory', async () => {
    await expect(service.finalize(join(root, 'missing'), 'bad-id')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.purgeJob('bad-id')).rejects.toThrow(ForbiddenException);
    expect(await service.removeJobDirectory(id, 'exports')).toBe('removed');
  });

  it('reads import artifacts only when their checksum matches and never serves them', async () => {
    const temp = await service.createUploadPath();
    const content = Buffer.from('{"rows":[]}');
    await writeFile(temp, content);
    const ref = await service.finalize(temp, id, { area: 'imports', format: 'json' });
    job.kind = 'import';
    job.artifactPath = ref.path;
    job.artifactHash = ref.hash;
    await expect(service.readImport(job)).resolves.toMatchObject({ content, format: 'json' });
    await expect(service.openAuthorized(id, actor)).rejects.toThrow('has no artifact');
    job.artifactHash = '0'.repeat(64);
    await expect(service.readImport(job)).rejects.toThrow('checksum');
  });

  it('sweeps old temporary files, keeps recent files and skips symlink directories', async () => {
    const oldPath = await service.createTemp('csv');
    const recentPath = await service.createTemp('json');
    await writeFile(oldPath, 'old');
    await writeFile(recentPath, 'recent');
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(oldPath, old, old);
    expect(await service.sweepTemp(new Date('2021-01-01T00:00:00Z'))).toBe(1);
    await expect(readFile(oldPath)).rejects.toThrow();
    await expect(readFile(recentPath)).resolves.toEqual(Buffer.from('recent'));

    const outside = join(root, 'outside');
    await mkdir(outside);
    await mkdir(join(root, 'tmp', 'directory-entry'));
    await mkdir(join(root, 'exports'), { recursive: true });
    const link = join(root, 'exports', id);
    await symlink(outside, link);
    expect(await service.removeJobDirectory(id, 'exports')).toBe('skipped');
    const regular = '00000000-0000-4000-8000-000000000003';
    await mkdir(join(root, 'exports', regular), { recursive: true });
    expect(await service.removeJobDirectory(regular, 'exports')).toBe('removed');
  });

  it('rejects absent jobs and artifacts whose file has been removed', async () => {
    jobs.findById.mockResolvedValueOnce(null);
    await expect(service.openAuthorized(id, actor)).rejects.toThrow('was not found');
    job.artifactPath = `exports/${id}/00000000-0000-4000-8000-000000000002.json`;
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(GoneException);
  });

  it('creates upload paths and lets administrators and scheduled operators access their jobs', async () => {
    const upload = await service.createUploadPath();
    expect(upload).toContain('/tmp/');
    await writeFile(upload, 'upload');

    const ref = await service.finalize(upload, id, { area: 'exports', format: 'csv' });
    job.artifactPath = ref.path;
    const admin = { ...actor, sub: 'admin', roles: ['integration_admin'] } as Actor;
    const adminArtifact = await service.openAuthorized(id, admin);
    adminArtifact.stream.destroy();

    job.kind = 'scheduled';
    job.requesterId = null;
    const scheduledArtifact = await service.openAuthorized(id, actor);
    scheduledArtifact.stream.destroy();
  });

  it('rejects jobs that are unfinished, expired without a date, or point at a directory', async () => {
    job.status = 'processing';
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(ConflictException);

    job.status = 'completed';
    job.artifactPath = `exports/${id}/00000000-0000-4000-8000-000000000002.json`;
    job.expiresAt = null;
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(GoneException);

    job.expiresAt = new Date(Date.now() + 60_000);
    await mkdir(join(root, 'exports', id, '00000000-0000-4000-8000-000000000002.json'), {
      recursive: true,
    });
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(ForbiddenException);
  });

  it('validates import paths and handles a missing temporary directory during a sweep', async () => {
    job.kind = 'import';
    job.artifactPath = `exports/${id}/00000000-0000-4000-8000-000000000002.json`;
    await expect(service.readImport(job)).rejects.toThrow(ForbiddenException);

    await rm(join(root, 'tmp'), { recursive: true, force: true });
    await expect(service.sweepTemp(new Date())).resolves.toBe(0);
  });

  it.each([
    `imports/${id}/00000000-0000-4000-8000-000000000002.json`,
    `exports/00000000-0000-4000-8000-000000000009/00000000-0000-4000-8000-000000000002.json`,
    `exports/${id}/not-a-generated-name.json`,
    `exports/${id}/00000000-0000-4000-8000-000000000002.exe`,
  ])('rejects artifact path %s', async (artifactPath) => {
    job.artifactPath = artifactPath;
    await expect(service.openAuthorized(id, actor)).rejects.toThrow(ForbiddenException);
  });
});
