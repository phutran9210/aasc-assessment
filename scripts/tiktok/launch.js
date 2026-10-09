import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Runs a compiled TikTok command from dist-tiktok/ with the current environment. The entry is
 * passed to Node as an argument vector, never through a shell, and secrets stay in the
 * environment instead of the command line.
 */
export function launch(relativeEntry, args = process.argv.slice(2)) {
  const entry = resolve(projectRoot, 'dist-tiktok', relativeEntry);
  if (!existsSync(entry)) {
    console.error(`Missing ${entry}. Run "pnpm build:tiktok" first.`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(`Could not start ${relativeEntry}: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
}
