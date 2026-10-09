import 'reflect-metadata';

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { buildTiktokDataSource } from '@/apps/tiktok/database/data-source.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { INTEGRATION_ROLES } from '../constants/integration-role.constants.js';
import type { IntegrationRole } from '../constants/integration-role.constants.js';
import { IntegrationUserEntity } from '../entities/integration-user.entity.js';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72;
const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/;
const WEAK_PASSWORDS = new Set(['demo-password-change-me', 'password1234', 'changeme12345']);

export type CreateUserInput = { username: string; roles: string[]; password: string };

/**
 * Creates an integration account and its audit record in one transaction. The password is
 * checked here so every caller, interactive or not, is held to the same rules.
 */
export async function createIntegrationUser(
  dataSource: DataSource,
  input: CreateUserInput,
): Promise<{ id: string; username: string; roles: IntegrationRole[] }> {
  if (!USERNAME.test(input.username)) {
    throw new Error('Username must be 3-80 characters: letters, digits, dot, dash or underscore');
  }
  const roles = [...new Set(input.roles)];
  if (
    !roles.length ||
    roles.some((role) => !(INTEGRATION_ROLES as readonly string[]).includes(role))
  ) {
    throw new Error(`Roles must be chosen from: ${INTEGRATION_ROLES.join(', ')}`);
  }
  if (
    input.password.length < MIN_PASSWORD_LENGTH ||
    Buffer.byteLength(input.password) > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(`Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} bytes long`);
  }
  if (WEAK_PASSWORDS.has(input.password) || input.password.includes(input.username)) {
    throw new Error('Password is a known placeholder or contains the username');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  return dataSource.transaction(async (tx) => {
    const users = tx.getRepository(IntegrationUserEntity);
    if (await users.findOne({ where: { username: input.username } })) {
      throw new Error('A user with this username already exists');
    }
    const id = uuidv7();
    await users.insert({
      id,
      username: input.username,
      passwordHash,
      roles,
      active: true,
      authVersion: 1,
    });
    await tx.getRepository(AuditEventEntity).insert({
      id: uuidv7(),
      scopeKey: 'integration-auth',
      actorId: null,
      eventType: 'user.created',
      aggregateType: 'integration_user',
      aggregateId: id,
      metadata: { username: input.username, roles, source: 'cli' },
    });
    return { id, username: input.username, roles: roles as IntegrationRole[] };
  });
}

/** Reads a line without echoing it; from a pipe it simply reads the first line. */
function readSecret(prompt: string): Promise<string> {
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const reader = createInterface({
    input: process.stdin,
    output: process.stdin.isTTY ? muted : undefined,
    terminal: Boolean(process.stdin.isTTY),
  });
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    reader.question('', (answer) => {
      reader.close();
      if (process.stdin.isTTY) process.stderr.write('\n');
      resolve(answer);
    });
  });
}

/** Usage: create-integration-user <username> <role>[,<role>]; the password is prompted for. */
async function main(): Promise<void> {
  const [username, roleList] = process.argv.slice(2);
  if (!username || !roleList) {
    throw new Error(`Usage: <username> <${INTEGRATION_ROLES.join('|')}>[,<role>]`);
  }
  const password = await readSecret('Password: ');
  if (process.stdin.isTTY && (await readSecret('Repeat password: ')) !== password) {
    throw new Error('Passwords do not match');
  }
  const dataSource = buildTiktokDataSource(validateTiktokEnv(process.env));
  try {
    await dataSource.initialize();
    const user = await createIntegrationUser(dataSource, {
      username,
      roles: roleList.split(','),
      password,
    });
    console.log(`Created ${user.username} with roles ${user.roles.join(', ')}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

if (process.argv[1]?.endsWith('/create-integration-user.js')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Could not create the user');
    process.exitCode = 1;
  });
}
