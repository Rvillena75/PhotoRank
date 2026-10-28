import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { summarizeBudgetObservations } from './comparison-budget-analysis';
import type { runBudgetStudy } from './comparison-budget-study';

const directory = resolve('local-data/ranking/comparison-budget-study');
const study = JSON.parse(readFileSync(resolve(directory, 'study.json'), 'utf8')) as ReturnType<typeof runBudgetStudy>;
const summary = summarizeBudgetObservations(study.observations);
writeFileSync(resolve(directory, 'summary.json'), `${JSON.stringify({ sessions: study.sessions, ...summary }, null, 2)}\n`);
const columns = ['n', 'k', 'kind', 'profile', 'membership80', 'membership90', 'membership95', 'membershipAndPairOrder90'] as const;
const csv = [columns.join(','), ...summary.summaries.map((row) => columns.map((key) => row[key] ?? '').join(','))].join('\n');
writeFileSync(resolve(directory, 'budgets.csv'), `${csv}\n`);
for (const row of summary.summaries.filter((item) => item.profile === 'consistent')) {
  process.stdout.write(`${row.n}\t${row.k}\t${row.kind}\t${row.membership90 ?? 'not reached by 4N'}\n`);
}
