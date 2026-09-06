/**
 * No tracked text file may mix line endings with itself.
 *
 * The hazard is not aesthetic. Several of this repo's edits are scripted --
 * a match-and-replace with an asserted hit count, which is the practice
 * CLAUDE.md requires precisely so a missed match fails loudly. A file that is
 * CRLF in one region and LF in another defeats that: a multi-line pattern
 * written in either flavour matches nothing in the other, the assertion fires,
 * and the pattern is character-for-character correct. It cost three failed
 * edits before the cause was visible, because both endings look identical in
 * every viewer. See LESSONS.jsonl, mixed-line-endings-in-one-file.
 *
 * The rule is CONSISTENCY, not a particular ending. A Linux checkout holds
 * pure LF and a Windows one pure CRLF; both pass. Only a file at war with
 * itself fails, which is always a tool having written the wrong ending into
 * part of a file rather than a platform difference.
 *
 * Reads the working tree rather than the index on purpose: the index is
 * normalised, and the working tree is where the scripted edits actually run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tracked files whose endings matter: the ones people and scripts edit. */
function textFiles(): string[] {
  const out = execFileSync(
    'git', ['ls-files', '*.ts', '*.js', '*.mjs', '*.md', '*.json', '*.html', '*.py', '*.yml'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 24 },
  );
  return out.split('\n').filter((f) => f.trim() !== '');
}

/** How a file ends its lines: 'crlf', 'lf', 'none', or the count of each when mixed. */
function endings(path: string): { crlf: number; total: number } {
  const raw = readFileSync(resolve(repoRoot, path));
  let crlf = 0, total = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== 0x0a) continue;
    total++;
    if (i > 0 && raw[i - 1] === 0x0d) crlf++;
  }
  return { crlf, total };
}

describe('line endings', () => {
  const files = textFiles();

  it('finds files to check, so a broken listing cannot pass as agreement', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('are consistent within every tracked text file', () => {
    const mixed = files
      .map((f) => ({ f, ...endings(f) }))
      .filter(({ crlf, total }) => crlf > 0 && crlf !== total)
      .map(({ f, crlf, total }) => `${f}: ${crlf} CRLF of ${total} lines`);
    expect(mixed).toEqual([]);
  });
});
