/**
 * Installs the repository's git hooks.
 *
 * They are tracked in `.githooks/` so they can be reviewed and changed like
 * any other code, and copied into the git directory on install, because git
 * does not run tracked hooks directly.
 *
 * `core.hooksPath` is deliberately NOT set here. On this machine it already
 * points at a global hook directory that refuses commits on main/master, and
 * repointing it at `.githooks` would silently disable that. The global hook
 * ends by delegating to `<git-dir>/hooks/<name>`, so copying there composes
 * with it instead of replacing it -- both rules run, in that order.
 *
 * `--git-dir` rather than `--git-common-dir` on purpose: it is what the
 * delegator resolves, and in a worktree the two differ. That does mean each
 * worktree needs its own install, which the summary line below says out loud.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

const source = join(repoRoot, '.githooks');
const target = join(resolve(repoRoot, git('rev-parse', '--git-dir')), 'hooks');

mkdirSync(target, { recursive: true });

const installed = [];
for (const name of readdirSync(source)) {
  const to = join(target, name);
  copyFileSync(join(source, name), to);
  // Ignored on Windows, required everywhere else.
  chmodSync(to, 0o755);
  installed.push(name);
}

console.log(`installed ${installed.join(', ')} -> ${target}`);
console.log('run this again in each worktree: the hook path is per-worktree');
