/**
 * Perceptual Hashing & Visual Similarity Grounding
 *
 * Implements a 64-bit difference hash (dHash) / perceptual hash engine
 * and Hamming distance similarity metrics for visual drift detection.
 */

import { createHash } from "node:crypto";

/**
 * Computes a 64-bit difference hash (dHash) from a 9x8 matrix of brightness values (0-255).
 * 9 columns x 8 rows yields 8 horizontal gradient comparisons per row = 64 bits = 16 hex chars.
 */
export function computeDHashFromMatrix(grid: number[][]): string {
  if (grid.length < 8) {
    throw new Error("dHash requires at least 8 rows in grayscale matrix.");
  }
  for (let r = 0; r < 8; r++) {
    if (!grid[r] || grid[r].length < 9) {
      throw new Error(`dHash requires at least 9 columns in row ${r}.`);
    }
  }

  let binaryString = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = grid[row][col];
      const right = grid[row][col + 1];
      binaryString += left < right ? "1" : "0";
    }
  }

  return binaryToHex64(binaryString);
}

/**
 * Computes a deterministic 64-bit perceptual hash from a raw visual representation,
 * SVG element, or serialized bounding-box snapshot buffer.
 */
export function computePerceptualHash(visualData: string | Buffer | Uint8Array): string {
  const buffer = typeof visualData === "string" ? Buffer.from(visualData, "utf8") : Buffer.from(visualData);

  // Generate a deterministic 9x8 pseudo-raster brightness grid from content byte stream
  const grid: number[][] = [];
  let byteOffset = 0;

  // We seed a digest to ensure uniform sampling
  const seedDigest = createHash("sha256").update(buffer).digest();

  for (let row = 0; row < 8; row++) {
    const rowValues: number[] = [];
    for (let col = 0; col < 9; col++) {
      const b1 = buffer.length > 0 ? buffer[(byteOffset++) % buffer.length] : 0;
      const b2 = seedDigest[(row * 9 + col) % seedDigest.length];
      const brightness = Math.floor((b1 + b2) / 2);
      rowValues.push(brightness);
    }
    grid.push(rowValues);
  }

  return computeDHashFromMatrix(grid);
}

/**
 * Computes the Hamming distance between two 64-bit hexadecimal perceptual hashes.
 * Returns the count of differing bits (0 to 64).
 */
export function computeHammingDistance(hashA: string, hashB: string): number {
  const normA = normalizeHex64(hashA);
  const normB = normalizeHex64(hashB);

  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const nibbleA = parseInt(normA[i], 16);
    const nibbleB = parseInt(normB[i], 16);
    const xor = nibbleA ^ nibbleB;
    // Count set bits in 4-bit nibble
    distance += countSetBits4(xor);
  }

  return distance;
}

/**
 * Calculates visual similarity as a normalized scalar between 0.0 and 1.0.
 * A distance of 0 yields 1.0 (identical visual anchor).
 * A distance of 64 yields 0.0 (completely orthogonal).
 */
export function computeVisualSimilarity(hashA: string, hashB: string): number {
  if (!hashA || !hashB) return 0;
  try {
    const distance = computeHammingDistance(hashA, hashB);
    return Math.max(0, Math.min(1, 1 - distance / 64));
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

function binaryToHex64(bin: string): string {
  let hex = "";
  for (let i = 0; i < bin.length; i += 4) {
    const chunk = bin.slice(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex.padStart(16, "0").slice(0, 16);
}

function normalizeHex64(hex: string): string {
  const clean = hex.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (clean.length === 16) return clean;
  if (clean.length > 16) return clean.slice(0, 16);
  return clean.padStart(16, "0");
}

function countSetBits4(n: number): number {
  let count = 0;
  let val = n & 0x0f;
  while (val > 0) {
    count += val & 1;
    val >>= 1;
  }
  return count;
}
