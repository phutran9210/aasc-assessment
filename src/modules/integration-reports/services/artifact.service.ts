import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Actor } from '@modules/integration-auth/types/index.js';
import type { ReportJobEntity } from '../entities/report-job.entity.js';
import { ReportJobRepository } from '../repositories/report-job.repository.js';
import { EXPORT_CONTENT_TYPES, EXPORT_FORMATS } from '../types/report.types.js';
import type { ArtifactRef, AuthorizedArtifact, ExportFormat } from '../types/report.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Owns the artifact directory, which lives outside `public/`. A file is written under `tmp/`,
 * moved into `exports/<jobId>/` with one atomic rename, and becomes downloadable only once the
 * job row references it; every name is generated here, never taken from a request.
 */
@Injectable()
export class ArtifactService {
  private readonly root: string;

  constructor(
    rootDirectory: string,
    private readonly jobs: ReportJobRepository,
  ) {
    this.root = resolve(rootDirectory);
  }

  async createTemp(format: ExportFormat): Promise<string> {
    const directory = join(this.root, 'tmp');
    await mkdir(directory, { recursive: true });
    return join(directory, `${randomUUID()}.${format}.part`);
  }

  /** Makes the finished temporary file durable and moves it to its final, generated name. */
  async finalize(tempPath: string, jobId: string): Promise<ArtifactRef> {
    assertUuid(jobId);
    const format = extname(tempPath.replace(/\.part$/, '')).slice(1);
    const handle = await open(tempPath, 'r+');
    let size: number;
    const hash = createHash('sha256');
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
        hash.update(chunk as Buffer);
      }
      await handle.sync();
      size = (await handle.stat()).size;
    } finally {
      await handle.close();
    }
    const relative = `exports/${jobId}/${randomUUID()}.${format}`;
    await mkdir(join(this.root, 'exports', jobId), { recursive: true });
    await rename(tempPath, join(this.root, relative));
    return { path: relative, hash: hash.digest('hex'), size };
  }

  async discard(tempPath: string): Promise<void> {
    if (!resolve(tempPath).startsWith(join(this.root, 'tmp') + sep)) return;
    await rm(tempPath, { force: true });
  }

  /** Removes every file of a job that the ledger does not vouch for, before a new attempt. */
  async purgeJob(jobId: string): Promise<void> {
    assertUuid(jobId);
    await rm(join(this.root, 'exports', jobId), { recursive: true, force: true });
  }

  /** Streams a temporary file once and removes it from disk as soon as it is opened. */
  async openTemp(
    tempPath: string,
  ): Promise<{ stream: AuthorizedArtifact['stream']; size: number }> {
    const handle = await open(tempPath, 'r');
    const { size } = await handle.stat();
    const unlinked = await unlink(tempPath).then(
      () => true,
      () => false,
    );
    const stream = handle.createReadStream();
    if (!unlinked) stream.once('close', () => void rm(tempPath, { force: true }));
    return { stream, size };
  }

  /**
   * Opens a finished artifact for its requester or an administrator. The job is checked in the
   * database before any path is touched, and the stored path must be the generated shape inside
   * this job's own directory.
   */
  async openAuthorized(jobId: string, actor: Actor): Promise<AuthorizedArtifact> {
    const job = UUID.test(jobId) ? await this.jobs.findById(jobId) : null;
    if (!job) throw new NotFoundException('Report job was not found');
    assertJobAccess(job, actor);
    if (job.status !== 'completed' || !job.artifactPath) {
      throw new ConflictException({
        code: 'REPORT_NOT_READY',
        message: 'Report is not ready yet',
        status: job.status,
      });
    }
    if (!job.expiresAt || job.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ code: 'REPORT_EXPIRED', message: 'Report artifact has expired' });
    }

    const [, directory, owner, name, ...rest] = ['', ...job.artifactPath.split('/')];
    const format = extname(name ?? '').slice(1) as ExportFormat;
    if (
      rest.length ||
      directory !== 'exports' ||
      owner !== job.id ||
      !UUID.test((name ?? '').slice(0, -(format.length + 1))) ||
      !EXPORT_FORMATS.includes(format)
    ) {
      throw new ForbiddenException('Report artifact path is not valid');
    }
    const absolute = resolve(this.root, 'exports', job.id, name);
    if (!absolute.startsWith(join(this.root, 'exports', job.id) + sep)) {
      throw new ForbiddenException('Report artifact path is not valid');
    }
    const stats = await lstat(absolute).catch(() => null);
    if (!stats)
      throw new GoneException({ code: 'REPORT_EXPIRED', message: 'Report artifact is gone' });
    if (!stats.isFile()) throw new ForbiddenException('Report artifact path is not valid');

    return {
      stream: createReadStream(absolute),
      size: stats.size,
      contentType: EXPORT_CONTENT_TYPES[format],
      filename: `leads-${job.id}.${format}`,
    };
  }
}

/** Owner or administrator; anyone else learns nothing beyond the refusal. */
export function assertJobAccess(job: ReportJobEntity, actor: Actor): void {
  if (job.requesterId !== actor.sub && !actor.roles.includes('integration_admin')) {
    throw new ForbiddenException('Report job belongs to another user');
  }
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new ForbiddenException('Report job id is not valid');
}
