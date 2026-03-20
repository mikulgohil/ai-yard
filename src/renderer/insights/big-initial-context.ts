import type { InitialContextSnapshot } from '../../shared/types.js';
import type { InsightAnalyzer, InsightResult } from './types.js';

const THRESHOLD_PERCENTAGE = 15;

export const bigInitialContext: InsightAnalyzer = {
  id: 'big-initial-context',
  analyze(snapshot: InitialContextSnapshot): InsightResult[] {
    if (snapshot.usedPercentage >= THRESHOLD_PERCENTAGE) {
      const pct = Math.round(snapshot.usedPercentage);
      const tokens = snapshot.totalTokens.toLocaleString();
      return [{
        id: 'big-initial-context',
        severity: 'warning',
        title: 'Large pre-context detected',
        description: `Pre-context uses ${pct}% of context window (${tokens} tokens). This may impact response quality and cost efficiency.`,
        metric: `${pct}%`,
      }];
    }
    return [];
  },
};
