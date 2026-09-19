-- ============================================================================
-- Industrial-Grade Event-Sourced Agent Execution Runtime Schema
-- Configured for SQLite with WAL Mode, strict foreign keys, and fencing tokens
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Immutable Event Ledger (Append-Only)
CREATE TABLE IF NOT EXISTS job_ledger (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    sequence_num INTEGER NOT NULL,
    payload TEXT NOT NULL,
    metadata TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CONSTRAINT uq_job_sequence UNIQUE (job_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_job_ledger_stream 
ON job_ledger(job_id, sequence_num ASC);

CREATE INDEX IF NOT EXISTS idx_job_ledger_type 
ON job_ledger(event_type, created_at DESC);

-- 2. Materialized State Projections / Snapshots (Every N Events)
CREATE TABLE IF NOT EXISTS job_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    last_sequence_num INTEGER NOT NULL,
    state_blob TEXT NOT NULL,
    checksum TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup 
ON job_snapshots(job_id, last_sequence_num DESC);

-- 3. Worker Leases & Distributed Fencing Registry
CREATE TABLE IF NOT EXISTS worker_leases (
    job_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    fence_token INTEGER NOT NULL DEFAULT 0,
    lease_expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leases_expiration 
ON worker_leases(lease_expires_at ASC);

-- 4. Idempotency Keys (Deduplication from Upstream Gateways)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'default',
    job_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (idempotency_key, scope)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_job 
ON idempotency_keys(job_id);

-- 5. Out-of-Band Operator Audit Trail
CREATE TABLE IF NOT EXISTS audit_events (
    audit_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_job 
ON audit_events(job_id, created_at DESC);
