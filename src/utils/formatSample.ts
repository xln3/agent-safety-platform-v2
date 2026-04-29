/**
 * Helpers for rendering inspect_ai sample fields in the UI.
 *
 * Background: `SampleItem.target` is typed as `unknown` because inspect_ai
 * eval logs surface different shapes per benchmark (string / string[] / object
 * / null). The frontend needs a single safe formatter so cells never crash on
 * a non-string value or render `[object Object]`.
 */

/** Render a `sample.target` value as a displayable string. */
export function formatTarget(target: unknown): string {
  if (target == null) return '-';
  if (typeof target === 'string') return target;
  try {
    return JSON.stringify(target);
  } catch {
    return String(target);
  }
}
