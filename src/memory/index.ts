/**
 * Sovereign Personal Memory & Daily Life OS - Main Entry Point
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CryptographicVault, VaultMasterConfig } from "./crypto/vault";
import { EmbeddingManager } from "./embeddings/manager";
import { HybridRetrievalEngine } from "./engine/retrieval";

export * from "./types";
export * from "./crypto/uuid";
export * from "./crypto/vault";
export * from "./embeddings/manager";
export * from "./engine/retrieval";

export interface SovereignMemorySystemConfig {
  db?: DatabaseSync;
  dbPath?: string;
  vaultConfig?: VaultMasterConfig;
}

export interface SovereignMemorySystem {
  db: DatabaseSync;
  vault: CryptographicVault;
  embeddings: EmbeddingManager;
  engine: HybridRetrievalEngine;
}

export function initializeSovereignMemorySystem(
  config: SovereignMemorySystemConfig = {}
): SovereignMemorySystem {
  const db = config.db ?? new DatabaseSync(config.dbPath ?? ":memory:");

  // Initialize Pragmas
  db.exec("PRAGMA foreign_keys = ON;");

  // Load and apply SQL schema
  try {
    const schemaPath = join(__dirname, "db", "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    db.exec(schemaSql);
  } catch {
    // Fallback inline DDL for bundled environments
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_atoms (
        memory_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        confidence REAL NOT NULL,
        consent_scope TEXT NOT NULL,
        retention_policy TEXT NOT NULL,
        retention_ttl_days INTEGER,
        is_encrypted INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT,
        is_deprecated INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_encryption_keys (
        key_id TEXT PRIMARY KEY,
        encrypted_dek TEXT NOT NULL,
        dek_iv TEXT NOT NULL,
        dek_auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        shredded_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        memory_id TEXT,
        category TEXT,
        timestamp TEXT NOT NULL,
        details TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        category,
        content,
        tokenize = 'unicode61'
      );
    `);
  }

  const vault = new CryptographicVault(
    config.vaultConfig ?? {
      userMasterKey: "sovereign_master_key_minimum_16_chars_long_entropy_vault",
    }
  );

  const embeddings = new EmbeddingManager({ optIn: false });
  const engine = new HybridRetrievalEngine(db, vault, embeddings);

  return { db, vault, embeddings, engine };
}
