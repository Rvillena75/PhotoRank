import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SYNTHETIC_FIXTURES } from './fixtures';
import { HUMAN_PROFILES } from './human-simulator';
import { BENCHMARK_VARIANTS, formatSummary, runBenchmark } from './runner';

function positiveIntegerFromEnvironment(name: string, rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function selectedById<T extends Readonly<{ id: string }>>(
  name: string,
  rawValue: string | undefined,
  available: readonly T[],
): readonly T[] {
  if (!rawValue) return available;
  const requested = new Set(rawValue.split(',').map((value) => value.trim()).filter(Boolean));
  const selected = available.filter(({ id }) => requested.has(id));
  const missing = [...requested].filter((id) => !available.some((candidate) => candidate.id === id));
  if (selected.length === 0 || missing.length > 0) {
    throw new RangeError(`${name} contains unknown ids: ${missing.join(', ') || rawValue}.`);
  }
  return selected;
}

const report = runBenchmark({
  sessionsPerScenario: positiveIntegerFromEnvironment(
    'PHOTORANK_BENCHMARK_SESSIONS',
    process.env.PHOTORANK_BENCHMARK_SESSIONS,
    8,
  ),
  confidenceSamples: positiveIntegerFromEnvironment(
    'PHOTORANK_BENCHMARK_SAMPLES',
    process.env.PHOTORANK_BENCHMARK_SAMPLES,
    500,
  ),
  fixtures: selectedById(
    'PHOTORANK_BENCHMARK_FIXTURES',
    process.env.PHOTORANK_BENCHMARK_FIXTURES,
    SYNTHETIC_FIXTURES,
  ),
  profiles: selectedById(
    'PHOTORANK_BENCHMARK_PROFILES',
    process.env.PHOTORANK_BENCHMARK_PROFILES,
    HUMAN_PROFILES,
  ),
  variants: selectedById(
    'PHOTORANK_BENCHMARK_VARIANTS',
    process.env.PHOTORANK_BENCHMARK_VARIANTS,
    BENCHMARK_VARIANTS,
  ),
});
const outputDirectory = resolve(process.cwd(), 'local-data/ranking/benchmark');
const outputPath = resolve(outputDirectory, 'latest.json');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

process.stdout.write(formatSummary(report));
process.stdout.write(`JSON reproducible: ${outputPath}\n`);
