import { Request, Response } from 'express';
import axios from 'axios';
import logger from '../utils/logger';
import { successResponse, errorResponse } from '../utils/response';

interface ParametersBody {
  apiBase?: string;
  apiKey?: string;
}

interface DifyVariable {
  variable: string;
  label?: string;
  type: string;
  required?: boolean;
  maxLength?: number | null;
  default?: string | null;
  options?: string[];
}

/**
 * Normalize Dify's user_input_form into a flat list of input variables.
 *
 * Dify returns entries like:
 *   [{ "text-input": { variable, label, required, ... } }, { "paragraph": {...} }, ...]
 *
 * We unwrap the single-key wrapper, preserving the type tag (text-input / paragraph / select / number).
 */
function flattenUserInputForm(form: unknown): DifyVariable[] {
  if (!Array.isArray(form)) return [];
  const out: DifyVariable[] = [];
  for (const entry of form) {
    if (!entry || typeof entry !== 'object') continue;
    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length === 0) continue;
    const type = keys[0];
    const meta = (entry as any)[type] || {};
    if (!meta.variable) continue;
    out.push({
      variable: String(meta.variable),
      label: meta.label ? String(meta.label) : undefined,
      type,
      required: !!meta.required,
      maxLength: meta.max_length ?? null,
      default: meta.default ?? null,
      options: Array.isArray(meta.options) ? meta.options.map(String) : undefined,
    });
  }
  return out;
}

/**
 * POST /api/dify-proxy/parameters
 * Body: { apiBase: string, apiKey: string }
 *
 * Calls Dify's GET /parameters and returns a normalized list of input variables.
 * Done server-side so the API key never leaves backend → browser CORS issues are avoided.
 */
export async function getDifyParametersHandler(req: Request, res: Response) {
  const { apiBase, apiKey } = (req.body || {}) as ParametersBody;
  if (!apiBase || !apiKey) {
    return res.status(400).json(errorResponse('apiBase 和 apiKey 必填', 400));
  }
  const url = `${apiBase.replace(/\/+$/, '')}/parameters`;
  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15_000,
    });
    const variables = flattenUserInputForm(resp.data?.user_input_form);
    return res.json(
      successResponse({
        variables,
        raw: resp.data,
      }),
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data || err?.message || 'unknown error';
    logger.error(
      `Dify /parameters proxy failed (status=${status}): ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`,
    );
    return res.status(502).json(
      errorResponse(
        typeof detail === 'string'
          ? detail
          : detail?.message || `Dify /parameters 调用失败 (HTTP ${status ?? 'n/a'})`,
        502,
      ),
    );
  }
}
