import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBudgetStudy } from './comparison-budget-study';

const repetitions = Number(process.env.PHOTORANK_BUDGET_REPETITIONS ?? 20);
const report = runBudgetStudy({ repetitions, onProgress: (message) => process.stdout.write(`${message}\n`) });
const sources = [
  'tools/ranking-benchmark/comparison-budget-study.ts', 'tools/ranking-benchmark/human-simulator.ts',
  'src/domain/ranking-config.ts', 'src/domain/pair-selection/adaptive-pair-selection-engine.ts',
  'src/domain/rating/ranking-session.ts', 'src/domain/rating/top-k.ts',
  'src/infrastructure/rating/ts-trueskill-rating-engine.ts', 'package-lock.json',
];
const sourceHashes = Object.fromEntries(sources.map((file) => [file,
  createHash('sha256').update(readFileSync(file)).digest('hex'),
]));
const directory = resolve('local-data/ranking/comparison-budget-study');
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'study.json'), `${JSON.stringify({ ...report, sourceHashes }, null, 2)}\n`);
process.stdout.write(`Saved ${report.sessions} sessions to ${directory}/study.json\n`);
