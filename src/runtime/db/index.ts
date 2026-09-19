import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Statement<T = unknown> {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface IRuntimeDb {
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): Statement<T>;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export class RuntimeDatabase implements IRuntimeDb {
  private readonly db: DatabaseSync;

  constructor(filePath = ":memory:") {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true });
    }

    this.db = new DatabaseSync(filePath);
    this.initializePragmasAndSchema();
  }

  private initializePragmasAndSchema(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");

    // Load schema definitions
    try {
      const schemaPath = join(__dirname, "schema.sql");
      const schemaSql = readFileSync(schemaPath, "utf-8");
      this.db.exec(schemaSql);
    } catch {
      // Direct DDL fallback if path resolution in bundled runtime differs
      this.db.exec(`
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
        CREATE INDEX IF NOT EXISTS idx_job_ledger_stream ON job_ledger(job_id, sequence_num ASC);
        CREATE INDEX IF NOT EXISTS idx_job_ledger_type ON job_ledger(event_type, created_at DESC);

        CREATE TABLE IF NOT EXISTS job_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            last_sequence_num INTEGER NOT NULL,
            state_blob TEXT NOT NULL,
            checksum TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON job_snapshots(job_id, last_sequence_num DESC);

        CREATE TABLE IF NOT EXISTS worker_leases (
            job_id TEXT PRIMARY KEY,
            worker_id TEXT NOT NULL,
            fence_token INTEGER NOT NULL DEFAULT 0,
            lease_expires_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_leases_expiration ON worker_leases(lease_expires_at ASC);

        CREATE TABLE IF NOT EXISTS idempotency_keys (
            idempotency_key TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'default',
            job_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (idempotency_key, scope)
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_job ON idempotency_keys(job_id);

        CREATE TABLE IF NOT EXISTS audit_events (
            audit_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            action TEXT NOT NULL,
            actor TEXT NOT NULL,
            details TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_job ON audit_events(job_id, created_at DESC);
      `);
    }
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare<T = unknown>(sql: string): Statement<T> {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return stmt.run(...(params as any[])) as { changes: number; lastInsertRowid: number | bigint };
      },
      get: (...params: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return stmt.get(...(params as any[])) as T | undefined;
      },
      all: (...params: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return stmt.all(...(params as any[])) as T[];
      },
    };
  }

  private transactionDepth = 0;

  public transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      return fn();
    }

    this.transactionDepth++;
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    } finally {
      this.transactionDepth--;
    }
  }

  public close(): void {
    this.db.close();
  }
}
