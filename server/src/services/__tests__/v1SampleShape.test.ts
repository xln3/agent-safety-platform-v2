import { describe, it, expect } from 'vitest';
import {
  allocateSamples,
  toV1RawSample,
  type V1Sample,
} from '../v1SampleShape';

describe('allocateSamples', () => {
  it('returns empty array when numTasks is 0', () => {
    expect(allocateSamples(0, 0)).toEqual([]);
    expect(allocateSamples(10, 0)).toEqual([]);
  });

  it('splits 20 across 3 tasks as 7/7/6 (Σ = 20)', () => {
    const out = allocateSamples(20, 3);
    expect(out).toEqual([7, 7, 6]);
    expect(out.reduce((s, n) => s + n, 0)).toBe(20);
  });

  it('splits 10 across 4 tasks as 3/3/2/2 (Σ = 10)', () => {
    const out = allocateSamples(10, 4);
    expect(out).toEqual([3, 3, 2, 2]);
    expect(out.reduce((s, n) => s + n, 0)).toBe(10);
  });

  it('splits 3 across 3 tasks as 1/1/1 (every task gets ≥1)', () => {
    expect(allocateSamples(3, 3)).toEqual([1, 1, 1]);
  });

  it('throws when totalCount < numTasks (zero-allocation forbidden)', () => {
    expect(() => allocateSamples(2, 3)).toThrow(/totalCount\(2\).*numTasks\(3\)/);
    expect(() => allocateSamples(0, 5)).toThrow(/totalCount\(0\).*numTasks\(5\)/);
  });

  it('handles single-task allocation cleanly', () => {
    expect(allocateSamples(50, 1)).toEqual([50]);
  });

  it('handles exact-division (no remainder) cleanly', () => {
    expect(allocateSamples(12, 4)).toEqual([3, 3, 3, 3]);
  });
});

describe('toV1RawSample', () => {
  const baseSample: V1Sample = {
    id: 'tq_0001',
    input: 'What is X?',
    target: 'Y',
    output: 'Y',
    status: 'success',
  };

  it('renames id → sampleId and prepends benchmark/taskName', () => {
    const out = toV1RawSample(baseSample, {
      benchmark: 'truthfulqa',
      taskName: 'truthfulqa',
    });
    expect(out).toEqual({
      benchmark: 'truthfulqa',
      taskName: 'truthfulqa',
      sampleId: 'tq_0001',
      input: 'What is X?',
      target: 'Y',
      output: 'Y',
      status: 'success',
    });
    expect((out as any).id).toBeUndefined();
  });

  it('preserves optional score / error fields when present', () => {
    const out = toV1RawSample(
      { ...baseSample, score: 0.85, error: undefined },
      { benchmark: 'b', taskName: 't' },
    );
    expect(out.score).toBe(0.85);
    expect(out.error).toBeUndefined();
  });

  it('preserves array / object target shapes', () => {
    const arrTarget = toV1RawSample(
      { ...baseSample, target: ['a', 'b', 'c'] },
      { benchmark: 'b', taskName: 't' },
    );
    expect(arrTarget.target).toEqual(['a', 'b', 'c']);

    const objTarget = toV1RawSample(
      { ...baseSample, target: { idx: 2, label: 'C' } },
      { benchmark: 'bbq', taskName: 'bbq_age' },
    );
    expect(objTarget.target).toEqual({ idx: 2, label: 'C' });
  });
});
