-- ====================================================================
-- Sovereign Personal Memory & Daily Life OS - Database Schema (SQLite)
-- Enforces:
-- 1. Categorical Memory Schema & Cryptographic Metadata Ledger
-- 2. Foreign key cascade integrity & Audit Trails
-- 3. Dedicated Vector Storage Table
-- 4. Synchronized FTS5 Lexical Search with Privacy Safeguards
-- ====================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------
-- 1. Core Memory Atoms Table
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_atoms (
    memory_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (
        category IN (
            'people', 'preferences', 'routines', 'projects', 'commitments',
            'documents', 'health_notes', 'subscriptions', 'purchases', 'recurring_problems'
        )
    ),
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    consent_scope TEXT NOT NULL CHECK (
        consent_scope IN ('local:private', 'briefing:allowed', 'cloud:opt-in-only')
    ),
    retention_policy TEXT NOT NULL CHECK (
        retention_policy IN ('ttl_days', 'retain_indefinitely', 'ephemeral_session', 'rolling_compaction')
    ),
    retention_ttl_days INTEGER,
    is_encrypted INTEGER NOT NULL DEFAULT 0 CHECK (is_encrypted IN (0, 1)),
    superseded_by TEXT,
    is_deprecated INTEGER NOT NULL DEFAULT 0 CHECK (is_deprecated IN (0, 1)),
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_mem_category ON memory_atoms(category);
CREATE INDEX IF NOT EXISTS idx_mem_timestamp ON memory_atoms(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mem_consent ON memory_atoms(consent_scope);
CREATE INDEX IF NOT EXISTS idx_mem_superseded ON memory_atoms(superseded_by);
CREATE INDEX IF NOT EXISTS idx_mem_active ON memory_atoms(is_deprecated, category);

-- --------------------------------------------------------------------
-- 2. Cryptographic Key Vault Table (Envelope Encryption & Shredding)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_encryption_keys (
    key_id TEXT PRIMARY KEY,
    encrypted_dek TEXT NOT NULL,
    dek_iv TEXT NOT NULL,
    dek_auth_tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    shredded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_key_shredded ON memory_encryption_keys(shredded_at);

-- --------------------------------------------------------------------
-- 3. Vector Embeddings Table
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_vectors (
    memory_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES memory_atoms(memory_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vec_model ON memory_vectors(model);

-- --------------------------------------------------------------------
-- 4. Audit Log Table (Zero-Trust Event Provenance)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    memory_id TEXT,
    category TEXT,
    timestamp TEXT NOT NULL,
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_memory ON audit_log(memory_id);

-- --------------------------------------------------------------------
-- 5. Human-In-The-Loop (HITL) Action Proposals & Approval Tickets
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS actuation_proposals (
    proposal_id TEXT PRIMARY KEY,
    target_tool TEXT NOT NULL,
    parameters TEXT NOT NULL,
    rationale TEXT NOT NULL,
    impact_level TEXT NOT NULL CHECK (impact_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
    cited_memories TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_tickets (
    ticket_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    hmac_signature TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED_EXPIRED', 'REJECTED_EXPLICIT', 'EXECUTED')
    ),
    decision_at TEXT,
    decision_actor TEXT,
    FOREIGN KEY (proposal_id) REFERENCES actuation_proposals(proposal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ticket_status ON approval_tickets(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_proposal ON approval_tickets(proposal_id);

-- --------------------------------------------------------------------
-- 6. FTS5 Full-Text Search Table (Lexical Search)
-- --------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    memory_id UNINDEXED,
    category,
    content,
    tokenize = 'unicode61'
);

-- --------------------------------------------------------------------
-- 7. Triggers for Automatic FTS Synchronization and Deletion Cascades
-- --------------------------------------------------------------------
-- Synchronize Insert: For encrypted records, do not leak raw ciphertext or unencrypted text into FTS
CREATE TRIGGER IF NOT EXISTS trg_memory_atoms_ai AFTER INSERT ON memory_atoms
BEGIN
    INSERT INTO memory_fts(memory_id, category, content)
    VALUES (
        new.memory_id,
        new.category,
        CASE WHEN new.is_encrypted = 1 THEN '[ENCRYPTED_VAULT_PAYLOAD]' ELSE new.content END
    );
END;

-- Synchronize Delete: Purge from FTS and Vectors when memory is hard deleted
CREATE TRIGGER IF NOT EXISTS trg_memory_atoms_ad AFTER DELETE ON memory_atoms
BEGIN
    DELETE FROM memory_fts WHERE memory_id = old.memory_id;
    DELETE FROM memory_vectors WHERE memory_id = old.memory_id;
END;

-- Synchronize Update: Update FTS record
CREATE TRIGGER IF NOT EXISTS trg_memory_atoms_au AFTER UPDATE ON memory_atoms
BEGIN
    DELETE FROM memory_fts WHERE memory_id = old.memory_id;
    INSERT INTO memory_fts(memory_id, category, content)
    VALUES (
        new.memory_id,
        new.category,
        CASE WHEN new.is_encrypted = 1 THEN '[ENCRYPTED_VAULT_PAYLOAD]' ELSE new.content END
    );
END;
