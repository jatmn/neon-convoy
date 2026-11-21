import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const passing = `
  import { describe, expect, test } from 'bun:test';
  describe('nested suite', () => {
    test('passes', () => expect(1).toBe(1));
  });
`;

function withBunReports(
  fixtures: Record<string, string>,
  verify: (recordInventory: () => void, directory: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'neon-test-inventory-'));
  try {
    execFileSync('git', ['init', '-q', directory]);
    for (const [file, source] of Object.entries(fixtures)) {
      const path = join(directory, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    execFileSync('git', ['add', '--', '.'], { cwd: directory });
    execFileSync(
      process.execPath,
      [
        'test',
        '--isolate',
        '--timings=unit.json',
        '--update-timings',
        '--reporter=junit',
        '--reporter-outfile=unit-junit.xml',
      ],
      { cwd: directory, stdio: 'pipe' },
    );
    const emptyBrowserReport = JSON.stringify({ suites: [], stats: {}, config: {} });
    writeFileSync(join(directory, 'browser.json'), emptyBrowserReport);
    writeFileSync(join(directory, 'distribution.json'), emptyBrowserReport);
    const recordInventory = () => {
      const inventory = JSON.stringify(import.meta.resolve('./test-inventory.ts'));
      execFileSync(
        process.execPath,
        ['-e', `import { recordTestInventory } from ${inventory}; recordTestInventory('.')`],
        { cwd: directory, stdio: 'pipe' },
      );
    };
    verify(recordInventory, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void test('rejects a Bun test that passed on retry', () => {
  withBunReports(
    {
      'retry.test.ts': `
        import { expect, test } from 'bun:test';
        let attempts = 0;
        test('passes on the second attempt', () => expect(++attempts).toBe(2), { retry: 1 });
      `,
    },
    (recordInventory) => assert.throws(recordInventory, /Unit report contains retried tests/),
  );
});

void test('rejects a loaded Bun file with no tests', () => {
  withBunReports({ 'empty.test.ts': 'export {};', 'passing.test.ts': passing }, (recordInventory) =>
    assert.throws(recordInventory, /No unit tests ran in empty\.test\.ts/),
  );
});

void test('matches Bun discovery and accounts for nested tests under their file', () => {
  const testFiles = ['example_test.ts', 'nested/a&b_spec.ts', 'uppercase.TEST.ts'];
  withBunReports(
    { [testFiles[0]]: passing, [testFiles[1]]: passing, [testFiles[2]]: passing, '__tests__/helper.ts': '' },
    (recordInventory, directory) => {
      recordInventory();
      const { files } = JSON.parse(readFileSync(join(directory, 'files.json'), 'utf8'));
      assert.deepEqual(new Set(Object.keys(files)), new Set(testFiles));
    },
  );
});
