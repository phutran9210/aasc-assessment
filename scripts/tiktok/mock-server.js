#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(projectRoot, 'dist-tiktok/apps/tiktok/cli/mock-server.js');
const child = spawn(process.execPath, [entry], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`Could not start the compiled mock server: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
