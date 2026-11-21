import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const xmlEntities = new Map([
  ['&amp;', '&'],
  ['&apos;', "'"],
  ['&quot;', '"'],
  ['&lt;', '<'],
  ['&gt;', '>'],
]);

function unitFiles(directory: string) {
  const { files }: { files: Record<string, number> } = JSON.parse(
    readFileSync(join(directory, 'unit.json'), 'utf8'),
  );
  const junit = readFileSync(join(directory, 'unit-junit.xml'), 'utf8');
  if (!/^<testsuites\b[^>]*\sskipped="0"/m.test(junit)) {
    throw new Error('Unit report contains skipped tests or is missing its skip count');
  }
  if (/<flakyFailure[\s>]/.test(junit)) throw new Error('Unit report contains retried tests');

  // Bun's JUnit reporter indents file suites by two spaces and nests describe suites inside them.
  const counts = new Map<string, number>();
  for (const [, encodedFile, count] of junit.matchAll(
    /^ {2}<testsuite name="[^"]*" file="([^"]*)" tests="(\d+)"/gm,
  )) {
    const file = encodedFile.replace(
      /&(?:amp|apos|quot|lt|gt|#\d+);/g,
      (entity) => xmlEntities.get(entity) ?? String.fromCodePoint(Number(entity.slice(2, -1))),
    );
    counts.set(file, Number(count));
  }
  for (const file of Object.keys(files)) {
    if (!counts.get(file)) throw new Error(`No unit tests ran in ${file}`);
  }
  return new Map(Object.entries(files));
}

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
    .filter((path) => /[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path));
  const files = unitFiles(directory);
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
