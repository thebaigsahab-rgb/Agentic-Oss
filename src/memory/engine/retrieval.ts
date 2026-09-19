/**
 * Hybrid Retrieval Engine & Strict Provenance Invariant
 * Implements:
 * 1. Two-phase Dense Vector Similarity (cosine) + Lexical Search (FTS5 / BM25).
 * 2. Cross-category privilege isolation (restricting sensitive categories from low-privilege contexts).
 * 3. Freshness decay: S(t) = S0 * exp(-lambda * (t - t0)).
 * 4. Stale fact invalidation & direct preference superseding (superseded_by pointers).
 * 5. Epistemic refusal protocol: strictly rejects missing or low-confidence (c < 0.70) inferences.
 * 6. Deterministic citation generation: [mem:<category>:<memory_id>].
 */

import { DatabaseSync } from "node:sqlite";
import {
  ContextPrivilege,
  EpistemicRefusal,
  isRestrictedCategory,
  MemoryAtom,
  MemoryCategory,
  PRIVILEGE_CATEGORY_MAP,
  RESTRICTED_CATEGORIES,
  RetrievalQuery,
  RetrievalResponse,
  ScoredMemoryResult,
  StoredMemoryRow,
} from "../types";
import { CryptographicVault, KeyShreddedError } from "../crypto/vault";
import { EmbeddingManager } from "../embeddings/manager";
import { generateUUIDv7 } from "../crypto/uuid";

export class EpistemicRefusalError extends Error {
  public readonly refusal: EpistemicRefusal;

  constructor(refusal: EpistemicRefusal) {
    super(refusal.reason);
    this.name = "EpistemicRefusalError";
    this.refusal = refusal;
  }
}

export class HybridRetrievalEngine {
  private readonly db: DatabaseSync;
  private readonly vault: CryptographicVault;
  private readonly embeddingManager: EmbeddingManager;

  constructor(
    db: DatabaseSync,
    vault: CryptographicVault,
    embeddingManager: EmbeddingManager
  ) {
    this.db = db;
    this.vault = vault;
    this.embeddingManager = embeddingManager;
  }

  /**
   * Ingests a new memory atom into sovereign storage with cryptographic isolation,
   * vector embedding, and FTS synchronization.
   */
  public insertMemory(
    atom: Omit<MemoryAtom, "memory_id" | "timestamp" | "is_encrypted"> & {
      memory_id?: string;
      timestamp?: string;
      is_encrypted?: boolean;
    }
  ): MemoryAtom {
    const memoryId = atom.memory_id ?? generateUUIDv7();
    const timestamp = atom.timestamp ?? new Date().toISOString();
    const category = atom.category;
    const confidence = Math.max(0.0, Math.min(1.0, atom.confidence));

    // Mandatory encryption check for restricted tier (health_notes, purchases, subscriptions)
    const requiresEncryption = isRestrictedCategory(category) || atom.is_encrypted === true;

    let storedContent = atom.content;
    let isEncryptedInt = 0;

    if (requiresEncryption) {
      const { payload, keyEntry } = this.vault.encrypt(atom.content, category);
      storedContent = JSON.stringify(payload);
      isEncryptedInt = 1;

      // Persist key metadata in database
      const keyStmt = this.db.prepare(`
        INSERT OR REPLACE INTO memory_encryption_keys (
          key_id, encrypted_dek, dek_iv, dek_auth_tag, created_at, shredded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      keyStmt.run(
        keyEntry.key_id,
        keyEntry.encrypted_dek,
        keyEntry.dek_iv,
        keyEntry.dek_auth_tag,
        keyEntry.created_at,
        keyEntry.shredded_at ?? null
      );
    }

    // Insert into memory_atoms
    const atomStmt = this.db.prepare(`
      INSERT INTO memory_atoms (
        memory_id, category, content, source, timestamp, confidence,
        consent_scope, retention_policy, retention_ttl_days, is_encrypted,
        superseded_by, is_deprecated, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    atomStmt.run(
      memoryId,
      category,
      storedContent,
      atom.source,
      timestamp,
      confidence,
      atom.consent_scope,
      atom.retention_policy,
      atom.retention_ttl_days ?? null,
      isEncryptedInt,
      atom.superseded_by ?? null,
      atom.is_deprecated ? 1 : 0,
      atom.metadata ? JSON.stringify(atom.metadata) : null
    );

    // Compute dense vector embedding locally on-device
    const vectorResult = this.embeddingManager.generateLocalEmbedding(atom.content);

    // Store vector embedding as BLOB
    const vecBuffer = Buffer.from(vectorResult.embedding.buffer);
    const vecStmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (
        memory_id, embedding, dimensions, model, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    vecStmt.run(
      memoryId,
      vecBuffer,
      vectorResult.dimensions,
      vectorResult.model,
      timestamp
    );

    // Log to audit trail
    const auditStmt = this.db.prepare(`
      INSERT INTO audit_log (audit_id, action, memory_id, category, timestamp, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      generateUUIDv7(),
      "INGEST_MEMORY",
      memoryId,
      category,
      new Date().toISOString(),
      `source: ${atom.source}, encrypted: ${isEncryptedInt === 1}`
    );

    return {
      memory_id: memoryId,
      category,
      content: atom.content,
      source: atom.source,
      timestamp,
      confidence,
      consent_scope: atom.consent_scope,
      retention_policy: atom.retention_policy,
      retention_ttl_days: atom.retention_ttl_days,
      is_encrypted: requiresEncryption,
      superseded_by: atom.superseded_by,
      is_deprecated: atom.is_deprecated,
      metadata: atom.metadata,
    };
  }

  /**
   * Directly supersedes an older memory entry with a newer fact/preference.
   * Updates superseded_by pointer on the stale memory and marks is_deprecated = 1
   * without destroying audit history.
   */
  public supersedeMemory(
    staleMemoryId: string,
    newContent: string,
    category: MemoryCategory,
    source: string,
    confidence = 0.95
  ): { newMemory: MemoryAtom; supersededOldId: string } {
    const newMemoryId = generateUUIDv7();
    const timestamp = new Date().toISOString();

    // 1. Ingest new memory
    const newMemory = this.insertMemory({
      memory_id: newMemoryId,
      category,
      content: newContent,
      source,
      timestamp,
      confidence,
      consent_scope: "briefing:allowed",
      retention_policy: "retain_indefinitely",
      is_encrypted: isRestrictedCategory(category),
      is_deprecated: false,
    });

    // 2. Deprecate and point older record
    const updateStmt = this.db.prepare(`
      UPDATE memory_atoms
      SET superseded_by = ?, is_deprecated = 1
      WHERE memory_id = ?
    `);
    updateStmt.run(newMemoryId, staleMemoryId);

    // 3. Log audit event
    const auditStmt = this.db.prepare(`
      INSERT INTO audit_log (audit_id, action, memory_id, category, timestamp, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      generateUUIDv7(),
      "SUPERSEDE_MEMORY",
      staleMemoryId,
      category,
      timestamp,
      `Superseded by new memory '${newMemoryId}'`
    );

    return { newMemory, supersededOldId: staleMemoryId };
  }

  /**
   * Cryptographic and relational hard deletion.
   * Purges relational records, FTS entries, vector embeddings, and shreds the encryption key.
   */
  public hardDeleteMemory(memoryId: string): boolean {
    // 1. Check if memory exists and if it is encrypted
    const selectStmt = this.db.prepare(`
      SELECT * FROM memory_atoms WHERE memory_id = ?
    `);
    const row = selectStmt.get(memoryId) as unknown as StoredMemoryRow | undefined;
    if (!row) {
      return false;
    }

    // 2. If encrypted, shred the cryptographic DEK
    if (row.is_encrypted === 1) {
      try {
        const payload = JSON.parse(row.content);
        if (payload && payload.key_id) {
          this.vault.shredKey(payload.key_id);

          // Update database encryption keys table
          const shredStmt = this.db.prepare(`
            UPDATE memory_encryption_keys
            SET shredded_at = ?
            WHERE key_id = ?
          `);
          shredStmt.run(new Date().toISOString(), payload.key_id);
        }
      } catch {
        // Continue with deletion even if payload parse fails
      }
    }

    // 3. Delete from relational tables and vector store
    this.db.prepare("DELETE FROM memory_vectors WHERE memory_id = ?").run(memoryId);
    this.db.prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(memoryId);
    this.db.prepare("DELETE FROM memory_atoms WHERE memory_id = ?").run(memoryId);

    // 4. Audit trail
    this.db.prepare(`
      INSERT INTO audit_log (audit_id, action, memory_id, category, timestamp, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      generateUUIDv7(),
      "HARD_DELETE",
      memoryId,
      row.category,
      new Date().toISOString(),
      "Cryptographic and relational deletion completed"
    );

    return true;
  }

  /**
   * Hybrid Vector + BM25 Retrieval Pipeline with category privilege isolation,
   * freshness decay, confidence gating, and citation attribution.
   */
  public retrieve(query: RetrievalQuery): RetrievalResponse {
    const minConfidence = query.min_confidence ?? 0.70;
    const limit = query.limit ?? 10;
    const refTime = query.reference_time ?? new Date();
    const decayLambda = query.decay_lambda ?? 0.05; // 5% per day decay for transient events

    // 1. Enforce Cross-Category Privilege Boundary
    const privilegeAllowed = PRIVILEGE_CATEGORY_MAP[query.privilege_context] ?? [];
    let targetCategories: MemoryCategory[];

    if (query.allowed_categories && query.allowed_categories.length > 0) {
      // Intersect requested categories with the context privilege limit
      targetCategories = query.allowed_categories.filter((cat) =>
        privilegeAllowed.includes(cat)
      );
    } else {
      targetCategories = [...privilegeAllowed];
    }

    // In low-privilege context, strictly exclude restricted categories under all conditions
    if (query.privilege_context === "low_privilege") {
      targetCategories = targetCategories.filter(
        (cat) => !RESTRICTED_CATEGORIES.includes(cat)
      );
    }

    if (targetCategories.length === 0) {
      return {
        refusal: true,
        reason: `Access denied: No permitted memory categories for privilege context '${query.privilege_context}'.`,
        threshold: minConfidence,
        max_found_confidence: 0.0,
        required_clarification: "Provide higher privilege context authorization.",
      };
    }

    // 2. Fetch Active (Non-Deprecated) Memory Records in Allowed Categories
    const placeholders = targetCategories.map(() => "?").join(",");
    const selectSql = `
      SELECT a.*, v.embedding as vec_blob, v.dimensions as vec_dim
      FROM memory_atoms a
      LEFT JOIN memory_vectors v ON a.memory_id = v.memory_id
      WHERE a.category IN (${placeholders})
        AND a.is_deprecated = 0
    `;

    const candidateRows = this.db
      .prepare(selectSql)
      .all(...targetCategories) as unknown as Array<
      StoredMemoryRow & { vec_blob?: Buffer; vec_dim?: number }
    >;

    if (candidateRows.length === 0) {
      return {
        refusal: true,
        reason: "No memory records found in authorized categories.",
        threshold: minConfidence,
        max_found_confidence: 0.0,
        required_clarification: "User clarification required for requested query.",
      };
    }

    // 3. Compute Query Dense Embedding
    const queryEmbResult = this.embeddingManager.generateLocalEmbedding(query.query);
    const queryVec = queryEmbResult.embedding;

    // Tokenize query words for BM25 lexical overlap
    const queryTokens = query.query.toLowerCase().split(/\W+/).filter(Boolean);

    const scoredResults: ScoredMemoryResult[] = [];
    let highestConfidence = 0.0;

    for (const row of candidateRows) {
      if (row.confidence > highestConfidence) {
        highestConfidence = row.confidence;
      }

      // Epistemic filter: ignore records with confidence below threshold
      if (row.confidence < minConfidence) {
        continue;
      }

      // Decrypt if encrypted
      let plaintext = row.content;
      if (row.is_encrypted === 1) {
        try {
          const payload = JSON.parse(row.content);
          plaintext = this.vault.decrypt(payload, row.category as MemoryCategory);
        } catch (err) {
          if (err instanceof KeyShreddedError) {
            // Key shredded -> mathematically deleted, ignore
            continue;
          }
          continue;
        }
      }

      // a. Compute Vector Cosine Similarity
      let vectorScore = 0.0;
      if (row.vec_blob && row.vec_dim) {
        const floatArray = new Float32Array(
          row.vec_blob.buffer,
          row.vec_blob.byteOffset,
          row.vec_blob.byteLength / Float32Array.BYTES_PER_ELEMENT
        );
        vectorScore = this.embeddingManager.cosineSimilarity(queryVec, floatArray);
      }

      // b. Compute Lexical Score (BM25 token overlap approximation)
      const textLower = plaintext.toLowerCase();
      let matches = 0;
      for (const token of queryTokens) {
        if (textLower.includes(token)) {
          matches++;
        }
      }
      const lexicalScore = queryTokens.length > 0 ? matches / queryTokens.length : 0.0;

      // c. Hybrid Score Fusion
      const hybridBase = 0.65 * vectorScore + 0.35 * lexicalScore;

      // d. Temporal Freshness Decay S(t) = S0 * exp(-lambda * delta_days)
      let decayMultiplier = 1.0;
      if (query.apply_freshness_decay !== false) {
        const memoryDate = new Date(row.timestamp);
        const diffMs = Math.max(0, refTime.getTime() - memoryDate.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        // Apply decay to transient categories (routines, commitments, recurring_problems)
        if (["routines", "commitments", "recurring_problems"].includes(row.category)) {
          decayMultiplier = Math.exp(-decayLambda * diffDays);
        }
      }

      const finalHybridScore = hybridBase * decayMultiplier * row.confidence;

      const memoryAtom: MemoryAtom = {
        memory_id: row.memory_id,
        category: row.category as MemoryCategory,
        content: plaintext,
        source: row.source,
        timestamp: row.timestamp,
        confidence: row.confidence,
        consent_scope: row.consent_scope as any,
        retention_policy: row.retention_policy as any,
        retention_ttl_days: row.retention_ttl_days,
        is_encrypted: row.is_encrypted === 1,
        superseded_by: row.superseded_by,
        is_deprecated: row.is_deprecated === 1,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };

      scoredResults.push({
        memory: memoryAtom,
        vector_score: vectorScore,
        lexical_score: lexicalScore,
        hybrid_score: finalHybridScore,
        decay_multiplier: decayMultiplier,
        citation: `[mem:${row.category}:${row.memory_id}]`,
      });
    }

    // Sort descending by final hybrid score
    scoredResults.sort((a, b) => b.hybrid_score - a.hybrid_score);

    const filtered = scoredResults.slice(0, limit);

    // Epistemic Refusal Protocol:
    // If no results meet min confidence or top result is below meaningful match threshold
    if (filtered.length === 0 || (filtered.length > 0 && filtered[0].hybrid_score < 0.15)) {
      return {
        refusal: true,
        reason: `Insufficient epistemic confidence (threshold c >= ${minConfidence.toFixed(
          2
        )}) or no grounded evidence found. Speculation prohibited.`,
        threshold: minConfidence,
        max_found_confidence: highestConfidence,
        required_clarification: `Please clarify or provide more specific details regarding: "${query.query}".`,
      };
    }

    return {
      refusal: false,
      results: filtered,
    };
  }

  /**
   * Deterministic portable export utility.
   * Yields a structured, human-readable JSON schema bundling all memory atoms,
   * cryptographic provenance traces, and audit logs.
   */
  public exportPortableArchive(includeDecrypted = false): {
    export_version: string;
    exported_at: string;
    records_count: number;
    memories: MemoryAtom[];
    audit_trail: unknown[];
  } {
    const rows = this.db
      .prepare("SELECT * FROM memory_atoms ORDER BY timestamp ASC")
      .all() as unknown as StoredMemoryRow[];
    const audit = this.db
      .prepare("SELECT * FROM audit_log ORDER BY timestamp ASC")
      .all();

    const atoms: MemoryAtom[] = rows.map((row) => {
      let content = row.content;
      if (row.is_encrypted === 1 && includeDecrypted) {
        try {
          const payload = JSON.parse(row.content);
          content = this.vault.decrypt(payload, row.category as MemoryCategory);
        } catch {
          content = "[ENCRYPTED_OR_SHREDDED]";
        }
      }

      return {
        memory_id: row.memory_id,
        category: row.category as MemoryCategory,
        content,
        source: row.source,
        timestamp: row.timestamp,
        confidence: row.confidence,
        consent_scope: row.consent_scope as any,
        retention_policy: row.retention_policy as any,
        retention_ttl_days: row.retention_ttl_days,
        is_encrypted: row.is_encrypted === 1,
        superseded_by: row.superseded_by,
        is_deprecated: row.is_deprecated === 1,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    });

    return {
      export_version: "1.0.0-sovereign-memory",
      exported_at: new Date().toISOString(),
      records_count: atoms.length,
      memories: atoms,
      audit_trail: audit,
    };
  }
}
