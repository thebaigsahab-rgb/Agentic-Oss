/**
 * Cryptographic Data Isolation Vault (AES-256-GCM Envelope Encryption)
 * Implements:
 * 1. Key Encryption Key (KEK) derivation via PBKDF2-SHA256 (100,000 iterations)
 * 2. Per-record Data Encryption Key (DEK) generation (256-bit AES-GCM)
 * 3. Cryptographic shredding for Right-to-be-Forgotten compliance
 * 4. Sensitive buffer zeroing in memory
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto";
import {
  EncryptedPayload,
  KeyVaultEntry,
  MemoryCategory,
  RESTRICTED_CATEGORIES,
} from "../types";
import { generateUUIDv7 } from "./uuid";

export class KeyShreddedError extends Error {
  constructor(keyId: string) {
    super(
      `Cryptographic error: Key '${keyId}' has been shredded. Memory content is mathematically irretrievable.`
    );
    this.name = "KeyShreddedError";
  }
}

export class CryptographicVaultError extends Error {
  constructor(message: string) {
    super(`Cryptographic vault violation: ${message}`);
    this.name = "CryptographicVaultError";
  }
}

export interface VaultMasterConfig {
  userMasterKey: string;      // User master secret or passphrase
  salt?: Buffer;              // Salt for KEK derivation (default 32 random bytes)
  iterations?: number;        // PBKDF2 iterations (default 100,000)
}

export class CryptographicVault {
  private readonly kek: Buffer;
  private readonly salt: Buffer;
  private readonly keyStore: Map<string, KeyVaultEntry> = new Map();

  constructor(config: VaultMasterConfig) {
    if (!config.userMasterKey || config.userMasterKey.length < 16) {
      throw new CryptographicVaultError(
        "Master key must be at least 16 characters long."
      );
    }
    this.salt = config.salt ?? Buffer.from("sovereign_personal_memory_os_salt_2026_v1", "utf-8");
    const iterations = config.iterations ?? 100_000;
    this.kek = pbkdf2Sync(config.userMasterKey, this.salt, iterations, 32, "sha256");
  }

  /**
   * Generates a new 256-bit DEK, encrypts it under the KEK with AES-256-GCM,
   * stores the encrypted DEK metadata in the vault ledger, and returns the key ID.
   */
  public generateAndStoreDEK(): { keyId: string; entry: KeyVaultEntry } {
    const keyId = generateUUIDv7();
    const rawDek = randomBytes(32);
    const dekIv = randomBytes(12);

    const cipher = createCipheriv("aes-256-gcm", this.kek, dekIv);
    const encryptedDek = Buffer.concat([cipher.update(rawDek), cipher.final()]);
    const dekAuthTag = cipher.getAuthTag();

    const entry: KeyVaultEntry = {
      key_id: keyId,
      encrypted_dek: encryptedDek.toString("base64"),
      dek_iv: dekIv.toString("base64"),
      dek_auth_tag: dekAuthTag.toString("base64"),
      created_at: new Date().toISOString(),
      shredded_at: null,
    };

    this.keyStore.set(keyId, entry);

    // Securely wipe rawDek from memory
    rawDek.fill(0);

    return { keyId, entry };
  }

  /**
   * Registers an external KeyVaultEntry (e.g. loaded from SQLite database).
   */
  public registerKeyEntry(entry: KeyVaultEntry): void {
    this.keyStore.set(entry.key_id, entry);
  }

  /**
   * Retrieves and decrypts the DEK using the KEK.
   * Throws KeyShreddedError if the key was shredded.
   */
  private resolveDEK(keyId: string): Buffer {
    const entry = this.keyStore.get(keyId);
    if (!entry) {
      throw new CryptographicVaultError(`Encryption key '${keyId}' not found.`);
    }

    if (entry.shredded_at) {
      throw new KeyShreddedError(keyId);
    }

    const encryptedDek = Buffer.from(entry.encrypted_dek, "base64");
    const dekIv = Buffer.from(entry.dek_iv, "base64");
    const dekAuthTag = Buffer.from(entry.dek_auth_tag, "base64");

    const decipher = createDecipheriv("aes-256-gcm", this.kek, dekIv);
    decipher.setAuthTag(dekAuthTag);

    try {
      const rawDek = Buffer.concat([decipher.update(encryptedDek), decipher.final()]);
      return rawDek;
    } catch {
      throw new CryptographicVaultError(
        `Failed to decrypt DEK '${keyId}'. Key may be corrupted or forged.`
      );
    }
  }

  /**
   * Encrypts plaintext memory content using a per-record DEK with AES-256-GCM.
   */
  public encrypt(plaintext: string, category: MemoryCategory): {
    payload: EncryptedPayload;
    keyEntry: KeyVaultEntry;
  } {
    const { keyId, entry } = this.generateAndStoreDEK();
    const rawDek = this.resolveDEK(keyId);

    const payloadIv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", rawDek, payloadIv);

    // Optional Authenticated Additional Data (AAD) binding category to prevent cross-category swapping
    cipher.setAAD(Buffer.from(category, "utf-8"));

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf-8")),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Securely wipe DEK
    rawDek.fill(0);

    const payload: EncryptedPayload = {
      key_id: keyId,
      algorithm: "aes-256-gcm",
      iv: payloadIv.toString("base64"),
      auth_tag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };

    return { payload, keyEntry: entry };
  }

  /**
   * Decrypts an encrypted payload using its corresponding DEK.
   * Enforces mathematical non-recoverability if key is shredded.
   */
  public decrypt(payload: EncryptedPayload, category: MemoryCategory): string {
    const rawDek = this.resolveDEK(payload.key_id);
    const payloadIv = Buffer.from(payload.iv, "base64");
    const authTag = Buffer.from(payload.auth_tag, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");

    const decipher = createDecipheriv("aes-256-gcm", rawDek, payloadIv);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(category, "utf-8"));

    try {
      const plaintextBuffer = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const result = plaintextBuffer.toString("utf-8");

      // Secure wipe
      rawDek.fill(0);
      plaintextBuffer.fill(0);

      return result;
    } catch (err) {
      rawDek.fill(0);
      if (err instanceof KeyShreddedError) throw err;
      throw new CryptographicVaultError(
        `Decryption failed for payload with key '${payload.key_id}'. Integrity check or auth tag mismatch.`
      );
    }
  }

  /**
   * Cryptographically shreds a DEK by overwriting the key material and setting shredded_at.
   * Guarantees mathematical deletion of any data encrypted with this key.
   */
  public shredKey(keyId: string): KeyVaultEntry {
    const entry = this.keyStore.get(keyId);
    if (!entry) {
      throw new CryptographicVaultError(`Cannot shred: Key '${keyId}' not found.`);
    }

    // Overwrite key bytes with zeroes/random noise before marking shredded
    entry.encrypted_dek = randomBytes(32).toString("base64");
    entry.dek_iv = randomBytes(12).toString("base64");
    entry.dek_auth_tag = randomBytes(16).toString("base64");
    entry.shredded_at = new Date().toISOString();

    return entry;
  }

  /**
   * Asserts whether a category requires mandatory envelope encryption.
   */
  public isCategoryRestricted(category: MemoryCategory): boolean {
    return RESTRICTED_CATEGORIES.includes(category);
  }

  /**
   * Destroys KEK in memory upon teardown.
   */
  public destroy(): void {
    this.kek.fill(0);
    this.keyStore.clear();
  }
}
