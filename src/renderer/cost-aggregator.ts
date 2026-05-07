import type { ArchivedSession, ProjectRecord, ProviderId, SessionRecord } from '../shared/types';
import { getCost } from './session-cost';

/**
 * Cross-session cost aggregator.
 *
 * Combines live cost data from `session-cost.ts` (active sessions, in-memory)
 * with `ArchivedSession.cost` (closed sessions, persisted in state.json).
 *
 * No external date library — ISO weeks and month bucketing use Date primitives.
 */

export type Granularity = 'daily' | 'weekly' | 'monthly';
export type Scope = 'project' | 'global';

export interface CostBucket {
  /** Display label, e.g. '2026-05-07', 'Wk 19 · 2026', 'May 2026'. */
  label: string;
  /** Sortable timestamp for the bucket start. */
  startMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
}

export interface ProviderCost {
  providerId: ProviderId;
  totalCostUsd: number;
  sessionCount: number;
}

export interface ProjectCost {
  projectId: string;
  projectName: string;
  totalCostUsd: number;
  sessionCount: number;
}

export interface TopRun {
  sessionId: string;
  sessionName: string;
  projectName: string;
  providerId: ProviderId | null;
  totalCostUsd: number;
  /** ISO timestamp for closed sessions; null for active. */
  endedAt: string | null;
  archived: boolean;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
  buckets: CostBucket[];
  byProvider: ProviderCost[];
  byProject: ProjectCost[];
  topRuns: TopRun[];
}

interface CostPoint {
  sessionId: string;
  sessionName: string;
  projectId: string;
  projectName: string;
  providerId: ProviderId | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Timestamp used for bucketing — closedAt for archived, createdAt for active. */
  bucketTimeMs: number;
  archived: boolean;
  endedAt: string | null;
}

export function summarize(
  projects: ProjectRecord[],
  scope: Scope,
  activeProjectId: string | null,
  granularity: Granularity,
): CostSummary {
  const inScope = scope === 'global'
    ? projects
    : projects.filter((p) => p.id === activeProjectId);

  const points = collectPoints(inScope);

  return {
    totalCostUsd: sumBy(points, (p) => p.costUsd),
    totalInputTokens: sumBy(points, (p) => p.inputTokens),
    totalOutputTokens: sumBy(points, (p) => p.outputTokens),
    sessionCount: points.length,
    buckets: bucketize(points, granularity),
    byProvider: groupByProvider(points),
    byProject: groupByProject(points),
    topRuns: pickTopRuns(points, 5),
  };
}

function collectPoints(projects: ProjectRecord[]): CostPoint[] {
  const points: CostPoint[] = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      const live = getCost(session.id);
      if (!live || live.totalCostUsd <= 0) continue;
      points.push(activePointFromSession(project, session, live));
    }
    for (const archived of project.sessionHistory ?? []) {
      if (!archived.cost || archived.cost.totalCostUsd <= 0) continue;
      points.push(archivedPoint(project, archived));
    }
  }
  return points;
}

function activePointFromSession(
  project: ProjectRecord,
  session: SessionRecord,
  cost: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number },
): CostPoint {
  return {
    sessionId: session.id,
    sessionName: session.name,
    projectId: project.id,
    projectName: project.name,
    providerId: session.providerId ?? null,
    costUsd: cost.totalCostUsd,
    inputTokens: cost.totalInputTokens,
    outputTokens: cost.totalOutputTokens,
    bucketTimeMs: parseTimestamp(session.createdAt) ?? Date.now(),
    archived: false,
    endedAt: null,
  };
}

function archivedPoint(project: ProjectRecord, archived: ArchivedSession): CostPoint {
  const closedMs = parseTimestamp(archived.closedAt);
  return {
    sessionId: archived.id,
    sessionName: archived.name,
    projectId: project.id,
    projectName: project.name,
    providerId: archived.providerId,
    costUsd: archived.cost?.totalCostUsd ?? 0,
    inputTokens: archived.cost?.totalInputTokens ?? 0,
    outputTokens: archived.cost?.totalOutputTokens ?? 0,
    bucketTimeMs: closedMs ?? parseTimestamp(archived.createdAt) ?? 0,
    archived: true,
    endedAt: archived.closedAt,
  };
}

function bucketize(points: CostPoint[], granularity: Granularity): CostBucket[] {
  if (points.length === 0) return [];

  const accum = new Map<string, CostBucket>();
  for (const p of points) {
    const key = bucketKey(p.bucketTimeMs, granularity);
    const existing = accum.get(key.key);
    if (existing) {
      existing.totalCostUsd += p.costUsd;
      existing.totalInputTokens += p.inputTokens;
      existing.totalOutputTokens += p.outputTokens;
      existing.sessionCount += 1;
    } else {
      accum.set(key.key, {
        label: key.label,
        startMs: key.startMs,
        totalCostUsd: p.costUsd,
        totalInputTokens: p.inputTokens,
        totalOutputTokens: p.outputTokens,
        sessionCount: 1,
      });
    }
  }

  // Fill zero gaps so the spend-over-time chart shows trends honestly.
  const sorted = [...accum.values()].sort((a, b) => a.startMs - b.startMs);
  return fillGaps(sorted, granularity);
}

interface BucketKey { key: string; label: string; startMs: number }

function bucketKey(ms: number, granularity: Granularity): BucketKey {
  const d = new Date(ms);
  if (granularity === 'daily') {
    const startMs = startOfDay(d).getTime();
    return { key: `D:${startMs}`, label: formatDay(d), startMs };
  }
  if (granularity === 'weekly') {
    const monday = startOfIsoWeek(d);
    const { year, week } = isoWeekParts(d);
    return {
      key: `W:${year}-${week}`,
      label: `Wk ${week} · ${year}`,
      startMs: monday.getTime(),
    };
  }
  const startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return { key: `M:${d.getFullYear()}-${d.getMonth()}`, label: formatMonth(d), startMs };
}

function fillGaps(sorted: CostBucket[], granularity: Granularity): CostBucket[] {
  if (sorted.length < 2) return sorted;
  const out: CostBucket[] = [];
  let prev: CostBucket | null = null;
  for (const cur of sorted) {
    if (prev) {
      let nextStart = stepForward(prev.startMs, granularity);
      while (nextStart < cur.startMs) {
        const filler = bucketKey(nextStart, granularity);
        out.push({
          label: filler.label,
          startMs: filler.startMs,
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          sessionCount: 0,
        });
        nextStart = stepForward(filler.startMs, granularity);
      }
    }
    out.push(cur);
    prev = cur;
  }
  return out;
}

function stepForward(ms: number, granularity: Granularity): number {
  const d = new Date(ms);
  if (granularity === 'daily') {
    d.setDate(d.getDate() + 1);
    return startOfDay(d).getTime();
  }
  if (granularity === 'weekly') {
    d.setDate(d.getDate() + 7);
    return startOfIsoWeek(d).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfIsoWeek(d: Date): Date {
  const out = new Date(d);
  // ISO weeks start on Monday. JS getDay(): Sun=0..Sat=6 → shift so Mon=0..Sun=6.
  const isoDow = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - isoDow);
  return startOfDay(out);
}

function isoWeekParts(d: Date): { year: number; week: number } {
  // ISO 8601: week 1 of a year contains the first Thursday.
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Move to Thursday of this week — Thursday determines the ISO year.
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: isoYear, week };
}

function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function groupByProvider(points: CostPoint[]): ProviderCost[] {
  const map = new Map<ProviderId, ProviderCost>();
  for (const p of points) {
    if (!p.providerId) continue;
    const existing = map.get(p.providerId);
    if (existing) {
      existing.totalCostUsd += p.costUsd;
      existing.sessionCount += 1;
    } else {
      map.set(p.providerId, { providerId: p.providerId, totalCostUsd: p.costUsd, sessionCount: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function groupByProject(points: CostPoint[]): ProjectCost[] {
  const map = new Map<string, ProjectCost>();
  for (const p of points) {
    const existing = map.get(p.projectId);
    if (existing) {
      existing.totalCostUsd += p.costUsd;
      existing.sessionCount += 1;
    } else {
      map.set(p.projectId, {
        projectId: p.projectId,
        projectName: p.projectName,
        totalCostUsd: p.costUsd,
        sessionCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function pickTopRuns(points: CostPoint[], limit: number): TopRun[] {
  return [...points]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, limit)
    .map((p) => ({
      sessionId: p.sessionId,
      sessionName: p.sessionName,
      projectName: p.projectName,
      providerId: p.providerId,
      totalCostUsd: p.costUsd,
      endedAt: p.endedAt,
      archived: p.archived,
    }));
}

function sumBy<T>(items: T[], pick: (t: T) => number): number {
  let acc = 0;
  for (const item of items) acc += pick(item);
  return acc;
}

function parseTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
