/**
 * Server-Sent Events broadcaster keyed by jobId.
 *
 * Multiple clients may subscribe to a job's stream. Each call to emit() writes
 * the event to all open responses for that job. Clients clean up via the
 * unsubscribe path (called from the route's `req.on('close')`).
 */

import type { Response } from 'express';
import logger from '../utils/logger';

export type SseEventName =
  | 'job.start'
  | 'job.finish'
  | 'task.start'
  | 'task.finish'
  | 'sample.start'
  | 'sample.finish'
  | 'heartbeat';

export interface SseEvent {
  event: SseEventName;
  data: Record<string, any>;
}

class SseService {
  private clients: Map<number, Set<Response>> = new Map();

  subscribe(jobId: number, res: Response): void {
    let set = this.clients.get(jobId);
    if (!set) {
      set = new Set();
      this.clients.set(jobId, set);
    }
    set.add(res);
    logger.debug(`SSE subscribe job=${jobId} (active=${set.size})`);
  }

  unsubscribe(jobId: number, res: Response): void {
    const set = this.clients.get(jobId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      this.clients.delete(jobId);
    }
  }

  emit(jobId: number, event: SseEventName, data: Record<string, any>): void {
    const set = this.clients.get(jobId);
    if (!set || set.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err: any) {
        logger.warn(`SSE write failed for job=${jobId}: ${err.message}`);
      }
    }
  }

  hasSubscribers(jobId: number): boolean {
    const set = this.clients.get(jobId);
    return !!(set && set.size > 0);
  }
}

export const sseService = new SseService();
export default sseService;
