import { beforeEach, describe, expect, it } from 'vitest';
import type { ArchivedSession, ProjectRecord, SessionRecord } from '../shared/types';
import { summarize } from './cost-aggregator';
import { _resetForTesting, restoreCost } from './session-cost';

beforeEach(() => {
  _resetForTesting();
});

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-active',
    name: 'Active session',
    providerId: 'claude',
    cliSessionId: null,
    createdAt: '2026-05-04T10:00:00.000Z',
    ...overrides,
  };
}

function makeArchived(overrides: Partial<ArchivedSession> = {}): ArchivedSession {
  return {
    id: 'a-1',
    name: 'Archived session',
    providerId: 'claude',
    cliSessionId: 'cli-1',
    createdAt: '2026-05-01T08:00:00.000Z',
    closedAt: '2026-05-01T09:00:00.000Z',
    cost: {
      totalCostUsd: 1.25,
      totalInputTokens: 1000,
      totalOutputTokens: 200,
      totalDurationMs: 60_000,
    },
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    name: 'Project 1',
    path: '/tmp/p1',
    sessions: [],
    activeSessionId: null,
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
    ...overrides,
  };
}

describe('summarize', () => {
  it('returns zeros for an empty workspace', () => {
    const summary = summarize([], 'global', null, 'daily');
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.sessionCount).toBe(0);
    expect(summary.buckets).toEqual([]);
    expect(summary.byProvider).toEqual([]);
    expect(summary.byProject).toEqual([]);
    expect(summary.topRuns).toEqual([]);
  });

  it('aggregates only the active project in project scope', () => {
    const projects = [
      makeProject({
        id: 'p1',
        name: 'P1',
        sessionHistory: [makeArchived({ id: 'a-p1', cost: { totalCostUsd: 5, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 } })],
      }),
      makeProject({
        id: 'p2',
        name: 'P2',
        sessionHistory: [makeArchived({ id: 'a-p2', cost: { totalCostUsd: 100, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 } })],
      }),
    ];
    const projectSummary = summarize(projects, 'project', 'p1', 'monthly');
    expect(projectSummary.totalCostUsd).toBe(5);
    expect(projectSummary.byProject.map((p) => p.projectId)).toEqual(['p1']);

    const globalSummary = summarize(projects, 'global', 'p1', 'monthly');
    expect(globalSummary.totalCostUsd).toBe(105);
    expect(globalSummary.byProject.map((p) => p.projectId)).toEqual(['p2', 'p1']);
  });

  it('combines live cost with archived cost', () => {
    const session = makeSession({ id: 'live-1' });
    restoreCost('live-1', {
      totalCostUsd: 3,
      totalInputTokens: 10,
      totalOutputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalDurationMs: 1000,
      totalApiDurationMs: 800,
    });
    const projects = [
      makeProject({
        sessions: [session],
        sessionHistory: [makeArchived({ id: 'arch-1' })],
      }),
    ];
    const summary = summarize(projects, 'global', 'p1', 'daily');
    // 3 (live) + 1.25 (archived) = 4.25
    expect(summary.totalCostUsd).toBeCloseTo(4.25, 5);
    expect(summary.sessionCount).toBe(2);
  });

  it('skips sessions with zero cost', () => {
    const session = makeSession({ id: 'zero' });
    restoreCost('zero', {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalDurationMs: 0,
      totalApiDurationMs: 0,
    });
    const projects = [makeProject({ sessions: [session] })];
    const summary = summarize(projects, 'global', null, 'daily');
    expect(summary.sessionCount).toBe(0);
  });

  it('groups providers and sorts descending by cost', () => {
    const projects = [
      makeProject({
        sessionHistory: [
          makeArchived({ id: 'a1', providerId: 'codex', cost: { totalCostUsd: 10, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 } }),
          makeArchived({ id: 'a2', providerId: 'claude', cost: { totalCostUsd: 7, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 } }),
          makeArchived({ id: 'a3', providerId: 'claude', cost: { totalCostUsd: 5, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 } }),
        ],
      }),
    ];
    const summary = summarize(projects, 'global', null, 'monthly');
    expect(summary.byProvider).toEqual([
      { providerId: 'claude', totalCostUsd: 12, sessionCount: 2 },
      { providerId: 'codex', totalCostUsd: 10, sessionCount: 1 },
    ]);
  });

  it('returns top runs sorted desc, capped at 5', () => {
    const archived: ArchivedSession[] = [];
    for (let i = 0; i < 7; i++) {
      archived.push(makeArchived({
        id: `a${i}`,
        name: `Run ${i}`,
        cost: { totalCostUsd: i * 1.5, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 },
      }));
    }
    const projects = [makeProject({ sessionHistory: archived })];
    const summary = summarize(projects, 'global', null, 'daily');
    expect(summary.topRuns).toHaveLength(5);
    expect(summary.topRuns[0].sessionName).toBe('Run 6');
    expect(summary.topRuns[4].sessionName).toBe('Run 2');
  });
});

describe('bucketize', () => {
  function archivedAt(closedAt: string, costUsd: number, id = `a-${closedAt}`): ArchivedSession {
    return makeArchived({
      id,
      closedAt,
      cost: { totalCostUsd: costUsd, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 },
    });
  }

  it('groups archived sessions into daily buckets', () => {
    // Use noon UTC so the bucketing is timezone-stable across CI runners (works
    // for any TZ between UTC-11 and UTC+11 — covers every realistic environment).
    const projects = [
      makeProject({
        sessionHistory: [
          archivedAt('2026-05-01T12:00:00.000Z', 1, 'a1'),
          archivedAt('2026-05-01T13:00:00.000Z', 2, 'a2'),
          archivedAt('2026-05-03T12:00:00.000Z', 4, 'a3'),
        ],
      }),
    ];
    const summary = summarize(projects, 'global', null, 'daily');
    // 3 buckets: day 1 ($3 = a1+a2), day 2 (zero-fill), day 3 ($4)
    expect(summary.buckets).toHaveLength(3);
    expect(summary.buckets[0].totalCostUsd).toBe(3);
    expect(summary.buckets[1].totalCostUsd).toBe(0);
    expect(summary.buckets[1].sessionCount).toBe(0);
    expect(summary.buckets[2].totalCostUsd).toBe(4);
  });

  it('groups by ISO week', () => {
    // 2026-05-04 is Monday (week 19). 2026-05-11 is Monday (week 20). Noon UTC keeps the
    // local date stable across TZs.
    const projects = [
      makeProject({
        sessionHistory: [
          archivedAt('2026-05-04T12:00:00.000Z', 2, 'w1a'),
          archivedAt('2026-05-07T12:00:00.000Z', 3, 'w1b'),
          archivedAt('2026-05-11T12:00:00.000Z', 5, 'w2'),
        ],
      }),
    ];
    const summary = summarize(projects, 'global', null, 'weekly');
    expect(summary.buckets).toHaveLength(2);
    expect(summary.buckets[0].label).toContain('Wk 19');
    expect(summary.buckets[0].totalCostUsd).toBe(5);
    expect(summary.buckets[1].label).toContain('Wk 20');
    expect(summary.buckets[1].totalCostUsd).toBe(5);
  });

  it('groups by month and labels with abbreviated month name', () => {
    const projects = [
      makeProject({
        sessionHistory: [
          archivedAt('2026-04-15T12:00:00.000Z', 1, 'm1'),
          archivedAt('2026-05-02T12:00:00.000Z', 2, 'm2'),
          archivedAt('2026-05-20T12:00:00.000Z', 3, 'm3'),
        ],
      }),
    ];
    const summary = summarize(projects, 'global', null, 'monthly');
    expect(summary.buckets).toHaveLength(2);
    expect(summary.buckets[0].label).toBe('Apr 2026');
    expect(summary.buckets[1].label).toBe('May 2026');
    expect(summary.buckets[1].totalCostUsd).toBe(5);
  });

  it('preserves chronological bucket order', () => {
    const projects = [
      makeProject({
        sessionHistory: [
          archivedAt('2026-05-03T12:00:00.000Z', 3, 'late'),
          archivedAt('2026-05-01T12:00:00.000Z', 1, 'early'),
        ],
      }),
    ];
    const summary = summarize(projects, 'global', null, 'daily');
    expect(summary.buckets.map((b) => b.startMs)).toEqual(
      [...summary.buckets.map((b) => b.startMs)].sort((a, b) => a - b),
    );
  });

});
