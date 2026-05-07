-- AI-yard SQLite schema sketch — see docs/IMPROVEMENTS.md B8.
--
-- STATUS: Reference only. Not wired to any code path. The current persistence
-- layer is `~/.ai-yard/state.json` via store.ts. Migrating to SQLite is a
-- dedicated multi-day effort; this file is the starting point.
--
-- Library: better-sqlite3 (sync, fast, well-supported in Electron).
-- File: ~/.ai-yard/state.db (replaces state.json on v2 → v2-sqlite migration).

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- One row per project.
CREATE TABLE projects (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    path                 TEXT NOT NULL,
    active_session_id    TEXT,
    layout_json          TEXT NOT NULL,           -- LayoutState (mode, splitPanes, splitDirection)
    overview_layout_json TEXT,                    -- OverviewLayout
    github_last_seen_json TEXT,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

-- Sessions, both active and archived. `status` differentiates.
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL,                -- 'claude' | 'codex' | 'copilot' | 'gemini'
    name            TEXT NOT NULL,
    cwd             TEXT NOT NULL,
    status          TEXT NOT NULL,                -- 'active' | 'archived' | 'history'
    cli_session_id  TEXT,                         -- provider-specific resume id
    cost_usd        REAL,
    cost_tokens     INTEGER,
    initial_context TEXT,                         -- InitialContextSnapshot JSON
    bookmarked      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    archived_at     INTEGER
);

CREATE INDEX sessions_project_idx       ON sessions(project_id, status);
CREATE INDEX sessions_cli_session_idx   ON sessions(cli_session_id) WHERE cli_session_id IS NOT NULL;

-- Kanban board, per project.
CREATE TABLE kanban_columns (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE kanban_tasks (
    id              TEXT PRIMARY KEY,
    column_id       TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    provider_id     TEXT,
    plan_mode       INTEGER NOT NULL DEFAULT 0,
    linked_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    sort_order      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX kanban_tasks_column_idx ON kanban_tasks(column_id, sort_order);

-- Team members are global (not per-project).
CREATE TABLE team_members (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    domain              TEXT,
    description         TEXT,
    system_prompt       TEXT NOT NULL,
    install_as_agent    INTEGER NOT NULL DEFAULT 0,
    agent_slug          TEXT,
    agent_filename      TEXT,
    icon                TEXT,
    sort_order          INTEGER NOT NULL,
    created_at          INTEGER NOT NULL
);

-- Preferences: a single-row key-value blob. Migration plan: split into typed columns later.
CREATE TABLE preferences (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    json  TEXT NOT NULL
);
INSERT INTO preferences (id, json) VALUES (1, '{}');

-- Insights: dismissed snapshots (so they don't re-fire) + readiness history.
CREATE TABLE insight_dismissals (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    insight_id TEXT NOT NULL,
    PRIMARY KEY (project_id, insight_id)
);

CREATE TABLE readiness_snapshots (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    captured_at INTEGER NOT NULL,
    score       INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    PRIMARY KEY (project_id, captured_at)
);

-- Full-text search over transcripts. The actual transcript files stay on disk
-- (they're large and provider-managed); we only index the searchable text.
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
    cli_session_id UNINDEXED,
    project_path   UNINDEXED,
    transcript_path UNINDEXED,
    text,
    tokenize = 'porter unicode61'
);

-- Migration table: tracks which schema version this DB was last migrated to.
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s', 'now') * 1000);
