-- Central scenario registry. Same Postgres as fury-server, applied at boot by
-- sqlx::migrate! in server/src/main.rs. Never store secrets here.

CREATE SCHEMA IF NOT EXISTS scn;

CREATE TABLE IF NOT EXISTS scn.worker_nodes (
    id             UUID PRIMARY KEY,
    org_id         UUID NOT NULL,
    machine_id     TEXT NOT NULL,
    capabilities   JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
    status         TEXT NOT NULL DEFAULT 'online',
    UNIQUE (org_id, machine_id)
);

CREATE TABLE IF NOT EXISTS scn.scenarios (
    id            UUID PRIMARY KEY,
    org_id        UUID NOT NULL,
    project_id    UUID,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('farm','warmup','custom')),
    spec          JSONB NOT NULL DEFAULT '{}'::jsonb,
    schedule_cron TEXT,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scn.scenario_runs (
    id          UUID PRIMARY KEY,
    org_id      UUID NOT NULL,
    scenario_id UUID NOT NULL REFERENCES scn.scenarios(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'queued',
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    stats       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scn.scenario_tasks (
    id           UUID PRIMARY KEY,
    org_id       UUID NOT NULL,
    run_id       UUID NOT NULL REFERENCES scn.scenario_runs(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL,
    worker_id    UUID REFERENCES scn.worker_nodes(id),
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','claimed','running','done','failed','skipped')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    attempts     INT NOT NULL DEFAULT 0,
    last_error   TEXT,
    result       JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (run_id, profile_id)
);
CREATE INDEX IF NOT EXISTS scenario_tasks_due ON scn.scenario_tasks (status, scheduled_at);

CREATE TABLE IF NOT EXISTS scn.scenario_events (
    id      BIGSERIAL PRIMARY KEY,
    org_id  UUID NOT NULL,
    run_id  UUID,
    task_id UUID,
    actor   UUID,
    action  TEXT NOT NULL,
    detail  JSONB NOT NULL DEFAULT '{}'::jsonb,
    at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same isolation model as migration 0006: FORCE is required because the
-- application role owns the tables, and WITH CHECK stops cross-org inserts.
ALTER TABLE scn.worker_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE scn.worker_nodes   FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scn.worker_nodes
    USING (public.user_in_org(org_id)) WITH CHECK (public.user_in_org(org_id));

ALTER TABLE scn.scenarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scn.scenarios      FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scn.scenarios
    USING (public.user_in_org(org_id)) WITH CHECK (public.user_in_org(org_id));

ALTER TABLE scn.scenario_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scn.scenario_runs  FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scn.scenario_runs
    USING (public.user_in_org(org_id)) WITH CHECK (public.user_in_org(org_id));

ALTER TABLE scn.scenario_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scn.scenario_tasks FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scn.scenario_tasks
    USING (public.user_in_org(org_id)) WITH CHECK (public.user_in_org(org_id));

ALTER TABLE scn.scenario_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scn.scenario_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scn.scenario_events
    USING (public.user_in_org(org_id)) WITH CHECK (public.user_in_org(org_id));

GRANT USAGE ON SCHEMA scn TO fury;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA scn TO fury;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA scn TO fury;
-- Append-only: same pattern as audit_events in 0001; do not grant these back.
REVOKE UPDATE, DELETE ON scn.scenario_events FROM fury;
