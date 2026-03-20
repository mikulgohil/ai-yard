import type { InitialContextSnapshot } from '../../shared/types.js';

export type InsightSeverity = 'info' | 'warning';

export interface InsightResult {
  id: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  metric?: string;
}

export interface InsightAnalyzer {
  id: string;
  analyze(snapshot: InitialContextSnapshot): InsightResult[];
}
