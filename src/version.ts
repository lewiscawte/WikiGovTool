import { execFileSync } from 'child_process';
import path from 'path';

export interface VersionInfo {
  // Short commit hash, or null when it can't be determined.
  commit: string | null;
  // The working tree had uncommitted changes when the server started (git checkouts only).
  dirty: boolean;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// Read once at startup. GIT_COMMIT overrides, for deployments without a .git directory.
function readVersion(): VersionInfo {
  const fromEnv = process.env.GIT_COMMIT?.trim();
  if (fromEnv) return { commit: fromEnv.slice(0, 12), dirty: false };
  try {
    return { commit: git(['rev-parse', '--short', 'HEAD']), dirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return { commit: null, dirty: false };
  }
}

export const version: VersionInfo = readVersion();
