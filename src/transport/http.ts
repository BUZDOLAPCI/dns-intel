import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { ServerConfig } from '../types.js';

/**
 * HTTP transport for health checks and optional HTTP-based access
 *
 * Note: The main MCP communication happens over stdio. This HTTP server
 * is optional and primarily useful for health checks in containerized deployments.
 */
export interface HttpTransport {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface HttpTransportOptions {
  port: number;
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
}

/**
 * Create an HTTP transport for health checks
 */
export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const { port, onHealthCheck } = options;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      try {
        const health = onHealthCheck
          ? await onHealthCheck()
          : { status: 'ok', checks: {} };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
      return;
    }

    if (url.pathname === '/ready' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: true }));
      return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return {
    server,
    start: () => {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, () => {
          resolve();
        });
      });
    },
    stop: () => {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

/**
 * Create HTTP transport from server config
 */
export function createHttpTransportFromConfig(
  config: ServerConfig,
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>
): HttpTransport {
  return createHttpTransport({
    port: config.httpPort,
    onHealthCheck,
  });
}
