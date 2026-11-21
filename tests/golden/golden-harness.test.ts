import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGoldenFixtures, readGolden } from './golden-fixtures.js';

/**
 * The golden harness itself: a missing recording fails the golden tests unless GOLDEN_RECORD=1, and a machine with
 * neither the local fixtures nor abir_test still skips them. Uses temporary files only, never tests/golden/local.
 */

const dir = mkdtempSync(join(tmpdir(), 'v3t-golden-harness-'));
const recorded = join(dir, 'recorded.golden.json');
const missing = join(dir, 'missing.golden.json');
writeFileSync(recorded, '{"steps":[]}');

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.GOLDEN_RECORD;
  delete process.env.GOLDEN_RECORD;
});
afterEach(() => {
  if (saved === undefined) delete process.env.GOLDEN_RECORD;
  else process.env.GOLDEN_RECORD = saved;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readGolden', () => {
  it('returns the recording to compare with', () => {
    expect(readGolden(recorded)).toBe('{"steps":[]}');
  });

  it('fails with a clear message when the recording is missing', () => {
    expect(() => readGolden(missing)).toThrow(`Golden recording missing: ${missing}.`);
    expect(() => readGolden(missing)).toThrow('GOLDEN_RECORD=1');
    expect(existsSync(missing)).toBe(false);
  });

  it('records only with GOLDEN_RECORD=1 exactly', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      process.env.GOLDEN_RECORD = value;
      expect(() => readGolden(missing), `GOLDEN_RECORD=${value}`).toThrow('Golden recording missing');
      expect(readGolden(recorded), `GOLDEN_RECORD=${value}`).toBe('{"steps":[]}');
    }
    process.env.GOLDEN_RECORD = '1';
    expect(readGolden(missing)).toBeNull();
    expect(readGolden(recorded)).toBeNull();
  });
});

describe('loadGoldenFixtures', () => {
  it('reads a local fixture file without looking for abir_test', async () => {
    const file = join(dir, 'fixtures.json');
    writeFileSync(file, JSON.stringify({ source: 'test', orders: [] }));
    await expect(loadGoldenFixtures({ fixtureFile: file, sourceDb: 'v3t_never_read' })).resolves.toEqual({ source: 'test', orders: [] });
  });

  it('returns null, so the golden tests skip, with neither the fixture file nor a source database', async () => {
    const before = readdirSync(dir).sort();
    const file = join(dir, 'local', 'golden-fixtures.json');
    await expect(loadGoldenFixtures({ fixtureFile: file, sourceDb: 'v3t_golden_no_source' })).resolves.toBeNull();
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});
