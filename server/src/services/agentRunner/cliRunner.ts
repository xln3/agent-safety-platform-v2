import { spawn } from 'child_process';
import type { AgentRunner, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';

interface CliConfig {
  commandTemplate: string;
  inputMode: 'placeholder' | 'stdin';
  timeoutSec?: number;
  env?: Record<string, string>;
}

function readConfig(agent: Agent): CliConfig {
  const cfg = (agent.config as any) || {};
  return {
    commandTemplate: cfg.commandTemplate || '',
    inputMode: cfg.inputMode === 'stdin' ? 'stdin' : 'placeholder',
    timeoutSec: cfg.timeoutSec ?? 120,
    env: cfg.env || {},
  };
}

/** Replace {INPUT} in a command string with a shell-safe single-quoted value. */
function injectPlaceholder(template: string, value: string): string {
  // Escape single quotes by closing/reopening: ' -> '"'"'
  const safe = `'${value.replace(/'/g, `'"'"'`)}'`;
  return template.replace(/\{INPUT\}/g, safe);
}

/** Spawn local CLI. Stdout = output. Returns when process exits or timeout fires. */
export const cliRunner: AgentRunner = {
  async run(agent: Agent, input: RunnerInput): Promise<RunnerOutput> {
    const cfg = readConfig(agent);
    if (!cfg.commandTemplate) {
      throw new Error(`Agent ${agent.id} (${agent.name}) missing CLI commandTemplate`);
    }

    const timeoutMs = Math.max(1, cfg.timeoutSec || 120) * 1000;
    const cmd =
      cfg.inputMode === 'placeholder'
        ? injectPlaceholder(cfg.commandTemplate, input.input || '')
        : cfg.commandTemplate;

    const startedAt = Date.now();

    return new Promise<RunnerOutput>((resolve, reject) => {
      const child = spawn('bash', ['-c', cmd], {
        env: { ...process.env, ...cfg.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`CLI runner spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const latencyMs = Date.now() - startedAt;
        if (killed) {
          reject(new Error(`CLI runner timed out after ${cfg.timeoutSec}s. stderr: ${stderr.slice(0, 500)}`));
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `CLI runner exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
            ),
          );
          return;
        }
        resolve({ output: stdout, latencyMs, raw: { stderr, code } });
      });

      if (cfg.inputMode === 'stdin') {
        child.stdin.write(input.input || '');
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  },
};

export default cliRunner;
