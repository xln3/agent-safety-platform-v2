/**
 * zipReader.ts
 *
 * Thin wrapper around adm-zip that adds zstd (compression method 93)
 * support. Newer inspect_ai versions write .eval ZIP files using
 * zstandard compression by default; adm-zip itself only knows STORE
 * and DEFLATE, so we fall back to fzstd for method-93 entries.
 */

import AdmZip from 'adm-zip';
import * as fzstd from 'fzstd';

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const METHOD_ZSTANDARD = 93;

/**
 * Read a single ZIP entry as a Buffer, transparently handling zstd.
 * Returns `null` when the entry is missing or decompression fails.
 */
export function readZipEntryBuffer(zip: AdmZip, entryName: string): Buffer | null {
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  const method = entry.header.method;
  try {
    if (method === METHOD_STORE || method === METHOD_DEFLATE) {
      return entry.getData();
    }
    if (method === METHOD_ZSTANDARD) {
      const compressed = entry.getCompressedData();
      const decompressed = fzstd.decompress(new Uint8Array(compressed));
      return Buffer.from(decompressed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a single ZIP entry as parsed JSON. Returns `null` on missing
 * entry, decompression failure, or invalid JSON.
 */
export function readZipEntryJson<T = any>(zip: AdmZip, entryName: string): T | null {
  const buf = readZipEntryBuffer(zip, entryName);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf-8')) as T;
  } catch {
    return null;
  }
}
