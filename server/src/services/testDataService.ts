/**
 * Test Data Service
 *
 * Loads and samples test data from YAML files for agent evaluation.
 * Test data is organized by task type (category), with each file containing
 * a list of test items (input prompts) used to test Dify agents.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestItem {
  id: string;
  input: string;
  category: string;
  tags?: string[];
}

interface TestDataFile {
  category: string;
  name: string;
  description?: string;
  items: Array<{
    id: string;
    input: string;
    tags?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cache: Record<string, TestItem[]> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTestDataDir(): string {
  const evalRoot = config.evalPocRoot || path.join(__dirname, '../../eval-engine');
  return path.join(evalRoot, 'test-data');
}

function parseFile(filePath: string): TestItem[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = yaml.load(raw) as TestDataFile;

  if (!data || !Array.isArray(data.items)) {
    logger.warn(`Invalid test data file: ${filePath}`);
    return [];
  }

  return data.items.map((item) => ({
    id: item.id,
    input: item.input,
    category: data.category,
    tags: item.tags,
  }));
}

function loadAll(): Record<string, TestItem[]> {
  if (cache) return cache;

  const dir = getTestDataDir();
  const result: Record<string, TestItem[]> = {};

  if (!fs.existsSync(dir)) {
    logger.warn(`Test data directory not found: ${dir}`);
    return result;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    const items = parseFile(path.join(dir, file));
    if (items.length > 0) {
      const category = items[0].category;
      result[category] = items;
    }
  }

  cache = result;
  logger.info(`Loaded test data: ${Object.keys(result).map((k) => `${k}(${result[k].length})`).join(', ')}`);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load test items for a specific category.
 */
export function loadTestData(category: string): TestItem[] {
  const all = loadAll();
  return all[category] || [];
}

/**
 * Load all test data grouped by category.
 */
export function loadAllTestData(): Record<string, TestItem[]> {
  return loadAll();
}

/**
 * Get available category keys that have test data.
 */
export function getAvailableCategories(): string[] {
  return Object.keys(loadAll());
}

/**
 * Sample test data from selected categories.
 *
 * @param categories - Which categories to draw from
 * @param mode - 'all' returns every item; 'random' samples a subset
 * @param count - Total items to sample (random mode only); split evenly across categories
 */
export function sampleTestData(
  categories: string[],
  mode: 'all' | 'random',
  count?: number,
): TestItem[] {
  const all = loadAll();

  // Collect items from selected categories
  const byCategory: Record<string, TestItem[]> = {};
  for (const cat of categories) {
    const items = all[cat];
    if (items && items.length > 0) {
      byCategory[cat] = [...items];
    }
  }

  const activeCats = Object.keys(byCategory);
  if (activeCats.length === 0) return [];

  if (mode === 'all') {
    // Return all items from selected categories
    const result: TestItem[] = [];
    for (const cat of activeCats) {
      result.push(...byCategory[cat]);
    }
    return result;
  }

  // Random mode: evenly split count across categories
  if (!count || count <= 0) return [];

  const perCategory = Math.max(1, Math.floor(count / activeCats.length));
  let remainder = count - perCategory * activeCats.length;

  const result: TestItem[] = [];
  for (const cat of activeCats) {
    const pool = byCategory[cat];
    const take = Math.min(pool.length, perCategory + (remainder > 0 ? 1 : 0));
    if (take > perCategory) remainder--;

    // Fisher-Yates shuffle then take first N
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    result.push(...pool.slice(0, take));
  }

  return result;
}

/**
 * Clear cached test data (useful for testing or hot-reload).
 */
export function clearCache(): void {
  cache = null;
}
