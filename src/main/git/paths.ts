import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ERR } from '../../shared/errors';
import { GitError } from './errors';

/** Reject NUL bytes, absolute paths, UNC paths and drive-qualified paths. */
export function validateRelativePath(input: string): string {
  if (!input || input.length > 4096) throw new GitError(ERR.validation('A path is required.'));
  if (input.includes('\0')) throw new GitError(ERR.validation('Paths may not contain NUL bytes.'));
  if (/^[a-zA-Z]:[\\/]/.test(input)) throw new GitError(ERR.unsafePath('Absolute Windows paths are not allowed here.'));
  if (input.startsWith('/') || input.startsWith('\\\\')) throw new GitError(ERR.unsafePath('Absolute paths are not allowed here.'));
  return input.replace(/\\/g, '/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Real path of the closest existing ancestor (supports files that will be created). */
async function realpathOfExistingAncestor(target: string): Promise<string> {
  let current = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, path.relative(current, target));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new GitError(ERR.unsafePath('Could not resolve the requested path.'));
}

/**
 * Resolve a repository-relative path to an absolute path, refusing traversal
 * and symlink escapes. `allowMissing` supports writing new files safely.
 */
export async function resolveInsideRepo(repoPath: string, relativePath: string, options: { allowMissing?: boolean } = {}): Promise<string> {
  const clean = validateRelativePath(relativePath);
  const repoRoot = path.resolve(repoPath);
  const target = path.resolve(repoRoot, clean);
  if (!isInside(repoRoot, target)) throw new GitError(ERR.unsafePath(`Path escapes the repository: ${relativePath}`));

  let realRepo: string;
  try {
    realRepo = await fs.realpath(repoRoot);
  } catch {
    throw new GitError(ERR.notFound(`Repository folder no longer exists: ${repoPath}`));
  }
  const realTarget = await realpathOfExistingAncestor(target);
  if (!isInside(realRepo, realTarget)) {
    throw new GitError(ERR.unsafePath(`Path resolves outside the repository through a link: ${relativePath}`));
  }
  if (!options.allowMissing) {
    try {
      await fs.lstat(realTarget);
    } catch {
      throw new GitError(ERR.notFound(`File not found: ${relativePath}`));
    }
  }
  return realTarget;
}

/** Convert an OS path to a repo-relative, forward-slash path. */
export function toRepoRelative(repoPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(repoPath), path.resolve(absolutePath));
  return relative.split(path.sep).join('/');
}

export async function canonicalizeExisting(pathValue: string): Promise<string> {
  try {
    const real = await fs.realpath(path.resolve(pathValue));
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new GitError(ERR.validation('The selected path is not a folder.'));
    return real;
  } catch (error) {
    if (error instanceof GitError) throw error;
    throw new GitError(ERR.io(`Folder not found: ${pathValue}`, String(error)));
  }
}
