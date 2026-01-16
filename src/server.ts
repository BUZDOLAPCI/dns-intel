import { getConfig, loadConfig } from './config.js';
import { createHttpTransportFromConfig, type HttpTransport } from './transport/http.js';
import type { ServerConfig } from './types.js';

/**
 * Standalone server configuration options
 */
export interface StandaloneServerOptions {
  port?: number;
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
}

/**
 * Standalone server instance
 */
export interface StandaloneServer {
  httpTransport: HttpTransport;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Create a standalone HTTP server for MCP protocol
 *
 * This creates an HTTP server that handles MCP requests at /mcp endpoint
 * using stateless JSON-RPC handling without session management.
 *
 * @example
 * ```typescript
 * const server = createStandaloneServer({ port: 3000 });
 * await server.start();
 * console.log('MCP server listening on port 3000');
 * ```
 */
export function createStandaloneServer(options: StandaloneServerOptions = {}): StandaloneServer {
  // Load config if not already loaded
  loadConfig();
  const config = getConfig();

  // Override port if provided
  const serverConfig: ServerConfig = {
    ...config,
    httpPort: options.port ?? config.httpPort,
  };

  const httpTransport = createHttpTransportFromConfig(serverConfig, {
    onHealthCheck: options.onHealthCheck ?? (async () => ({
      status: 'ok',
      checks: {
        server: true,
      },
    })),
  });

  return {
    httpTransport,
    start: async () => {
      await httpTransport.start();
      console.error(`[INFO] DNS Intel MCP HTTP server listening on port ${serverConfig.httpPort}`);
      console.error(`[INFO] MCP endpoint: http://localhost:${serverConfig.httpPort}/mcp`);
      console.error(`[INFO] Health endpoint: http://localhost:${serverConfig.httpPort}/health`);
    },
    stop: async () => {
      await httpTransport.stop();
      console.error('[INFO] Server stopped');
    },
  };
}
