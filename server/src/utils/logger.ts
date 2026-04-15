type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: LogLevel, message: string, ...args: any[]): string {
  const timestamp = formatTimestamp();
  const upperLevel = level.toUpperCase().padEnd(5);
  const extra = args.length > 0
    ? ' ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    : '';
  return `[${timestamp}] [${upperLevel}] ${message}${extra}`;
}

export const logger = {
  debug(message: string, ...args: any[]): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, ...args));
    }
  },

  info(message: string, ...args: any[]): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, ...args));
    }
  },

  warn(message: string, ...args: any[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, ...args));
    }
  },

  error(message: string, ...args: any[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, ...args));
    }
  },
};

export default logger;
