import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

function browserFiles(report: JSONReport) {
  if (report.stats.skipped || report.stats.flaky || report.stats.unexpected) {
    throw new Error('Browser report contains skipped, retried, or failed tests');
  }
  const files = new Map<string, number>();
  const visit = (suite: JSONReportSuite) => {
    const file = relative(process.cwd(), resolve(report.config.rootDir, suite.file));
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const [result] = test.results;
        if (test.results.length !== 1 || result.status !== 'passed') {
          throw new Error(`Expected one passing attempt of ${spec.title} (${test.projectName})`);
        }
        files.set(file, (files.get(file) ?? 0) + result.duration);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return files;
}

export function recordTestInventory(directory: string) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/.*\.[cm]?[jt]sx?$/.test(path));
  const raw: { files: Record<string, number> } = JSON.parse(
    readFileSync(join(directory, 'unit.json'), 'utf8'),
  );
  const junit = readFileSync(join(directory, 'unit-junit.xml'), 'utf8');
  if (!/<testsuites\b[^>]*\bskipped="0"/.test(junit)) throw new Error('Unit report contains skipped tests');
  const files = new Map(Object.entries(raw.files));
  for (const report of ['browser', 'distribution']) {
    const results: JSONReport = JSON.parse(readFileSync(join(directory, `${report}.json`), 'utf8'));
    for (const [file, elapsed] of browserFiles(results)) {
      if (files.has(file)) throw new Error(`Test file ran in more than one suite: ${file}`);
      files.set(file, elapsed);
    }
  }
  const missing = tracked.filter((file) => !files.has(file));
  const extra = [...files.keys()].filter((file) => !tracked.includes(file));
  const overBudget = [...files].filter(([, elapsed]) => !Number.isFinite(elapsed) || elapsed >= 20_000);
  const errors = [
    ...missing.map((file) => `Missing test file: ${file}`),
    ...extra.map((file) => `Unexpected test file: ${file}`),
    ...overBudget.map(([file, elapsed]) => `Test file exceeds 20 s: ${file} (${elapsed} ms)`),
  ];
  if (errors.length) throw new Error(errors.join('\n'));
  writeFileSync(
    join(directory, 'files.json'),
    JSON.stringify({ version: 1, files: Object.fromEntries(files) }, null, 2) + '\n',
  );
  console.log(`Test inventory: ${files.size} tracked files ran within their file budgets`);
}
