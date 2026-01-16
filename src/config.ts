import type { ServerConfig } from './types.js';

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): ServerConfig {
  return {
    defaultResolver: process.env['DNS_RESOLVER'] ?? '8.8.8.8',
    requestTimeoutMs: parseInt(process.env['REQUEST_TIMEOUT_MS'] ?? '10000', 10),
    httpPort: parseInt(process.env['HTTP_PORT'] ?? '8080', 10),
    logLevel: parseLogLevel(process.env['LOG_LEVEL']),
  };
}

function parseLogLevel(level: string | undefined): ServerConfig['logLevel'] {
  const validLevels = ['debug', 'info', 'warn', 'error'] as const;
  if (level && validLevels.includes(level as ServerConfig['logLevel'])) {
    return level as ServerConfig['logLevel'];
  }
  return 'info';
}

/**
 * Global configuration instance
 */
let config: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export function setConfig(newConfig: Partial<ServerConfig>): void {
  config = { ...getConfig(), ...newConfig };
}
