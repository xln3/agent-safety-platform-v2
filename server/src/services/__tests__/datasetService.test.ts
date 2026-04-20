import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Mock fs so we control what the "filesystem" returns.
// We must mock before importing the module under test.
// ---------------------------------------------------------------------------
vi.mock('fs');
vi.mock('child_process');
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../venvService', () => ({
  getPythonPath: vi.fn(() => '/fake/python3'),
}));

import {
  checkAllDatasetStatus,
  checkDatasetReady,
  getDatasetCacheEnv,
} from '../datasetService';

// ---------------------------------------------------------------------------
// Helper: set up fs.existsSync / fs.readFileSync to return manifest data
// ---------------------------------------------------------------------------
function mockManifest(manifest: object | null) {
  const existsSyncMock = vi.mocked(fs.existsSync);
  const readFileSyncMock = vi.mocked(fs.readFileSync);

  if (manifest === null) {
    // Manifest file does not exist
    existsSyncMock.mockReturnValue(false);
  } else {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify(manifest));
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// checkAllDatasetStatus
// ---------------------------------------------------------------------------

describe('checkAllDatasetStatus', () => {
  it('should return all datasets as not-ready when no manifest exists', () => {
    mockManifest(null);

    const statuses = checkAllDatasetStatus();
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses.length).toBeGreaterThan(0);

    for (const s of statuses) {
      expect(s.ready).toBe(false);
      expect(s.message).toContain('Not cached');
    }
  });

  it('should return empty manifest as all not-ready', () => {
    mockManifest({ datasets: {} });

    const statuses = checkAllDatasetStatus();
    for (const s of statuses) {
      expect(s.ready).toBe(false);
    }
  });

  it('should mark a dataset as ready when it is in the manifest', () => {
    const cachedAt = '2026-04-20T12:00:00.000Z';
    mockManifest({
      datasets: {
        xstest: { cachedAt, source: 'hf' },
      },
    });

    const statuses = checkAllDatasetStatus();
    const xstest = statuses.find((s) => s.benchmark === 'xstest');
    expect(xstest).toBeDefined();
    expect(xstest!.ready).toBe(true);
    expect(xstest!.cachedAt).toBe(cachedAt);
    expect(xstest!.message).toContain(cachedAt);
  });

  it('should indicate HF_TOKEN requirement for gated datasets', () => {
    mockManifest({ datasets: {} });

    const statuses = checkAllDatasetStatus();
    const xstest = statuses.find((s) => s.benchmark === 'xstest');
    expect(xstest).toBeDefined();
    expect(xstest!.ready).toBe(false);
    expect(xstest!.message).toContain('HF_TOKEN');
  });

  it('should include correct source types', () => {
    mockManifest({ datasets: {} });

    const statuses = checkAllDatasetStatus();
    const sources = new Set(statuses.map((s) => s.source));
    // Registry has hf and github sources
    expect(sources.has('hf')).toBe(true);
    expect(sources.has('github')).toBe(true);
  });

  it('should handle corrupted manifest file gracefully', () => {
    const existsSyncMock = vi.mocked(fs.existsSync);
    const readFileSyncMock = vi.mocked(fs.readFileSync);

    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('NOT VALID JSON {{{');

    // Should not throw; fallback to empty manifest
    const statuses = checkAllDatasetStatus();
    expect(Array.isArray(statuses)).toBe(true);
    for (const s of statuses) {
      expect(s.ready).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// checkDatasetReady
// ---------------------------------------------------------------------------

describe('checkDatasetReady', () => {
  it('should return true for benchmarks not in the registry (local data)', () => {
    mockManifest({ datasets: {} });

    // 'clash_eval' is not in DATASET_REGISTRY, it is local
    expect(checkDatasetReady('clash_eval')).toBe(true);
    expect(checkDatasetReady('raccoon')).toBe(true);
    expect(checkDatasetReady('completely_unknown')).toBe(true);
  });

  it('should return false for registered benchmark not in manifest', () => {
    mockManifest({ datasets: {} });

    expect(checkDatasetReady('xstest')).toBe(false);
    expect(checkDatasetReady('strong_reject')).toBe(false);
  });

  it('should return true for registered benchmark present in manifest', () => {
    mockManifest({
      datasets: {
        xstest: { cachedAt: '2026-04-20T12:00:00.000Z', source: 'hf' },
        strong_reject: { cachedAt: '2026-04-20T12:00:00.000Z', source: 'github' },
      },
    });

    expect(checkDatasetReady('xstest')).toBe(true);
    expect(checkDatasetReady('strong_reject')).toBe(true);
  });

  it('should return false when manifest file does not exist', () => {
    mockManifest(null);

    expect(checkDatasetReady('xstest')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDatasetCacheEnv
// ---------------------------------------------------------------------------

describe('getDatasetCacheEnv', () => {
  it('should return all required offline environment variables', () => {
    const env = getDatasetCacheEnv();

    expect(env).toHaveProperty('HF_DATASETS_OFFLINE', '1');
    expect(env).toHaveProperty('HF_HOME');
    expect(env).toHaveProperty('HF_DATASETS_CACHE');
    expect(env).toHaveProperty('TRANSFORMERS_OFFLINE', '1');
    expect(env).toHaveProperty('HF_HUB_OFFLINE', '1');
    expect(env).toHaveProperty('HF_UPDATE_DOWNLOAD_COUNTS', '0');
  });

  it('should return paths that are absolute', () => {
    const env = getDatasetCacheEnv();

    expect(path.isAbsolute(env.HF_HOME)).toBe(true);
    expect(path.isAbsolute(env.HF_DATASETS_CACHE)).toBe(true);
  });

  it('should have HF_DATASETS_CACHE as a subdirectory of HF_HOME', () => {
    const env = getDatasetCacheEnv();

    // HF_HOME = .../datasets-cache, HF_DATASETS_CACHE = .../datasets-cache/datasets
    expect(env.HF_DATASETS_CACHE.startsWith(env.HF_HOME)).toBe(true);
  });
});
