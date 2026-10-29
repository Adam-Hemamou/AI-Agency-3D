/** Journal minimal et horodaté. Pourra être remplacé par une bibliothèque dédiée plus tard. */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) out(line);
  else out(line, meta);
}

export const logger = {
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
