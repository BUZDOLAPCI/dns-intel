import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerConfig } from '../types.js';

/**
 * HTTP transport for MCP protocol and health checks
 *
 * This HTTP server provides:
 * - /mcp endpoint for MCP protocol via StreamableHTTPServerTransport
 * - /health endpoint for health checks in containerized deployments
 * - /ready endpoint for readiness probes
 */
export interface HttpTransport {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface HttpTransportOptions {
  port: number;
  createMcpServer?: () => McpServer;
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
}

// Session management for MCP connections
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

/**
 * Handle MCP requests at /mcp endpoint
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  createMcpServer?: () => McpServer
): Promise<void> {
  // Get or create session
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    // Create new session
    if (!createMcpServer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MCP server not configured' }));
      return;
    }

    sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
    });
    const server = createMcpServer();

    session = { transport, server };
    sessions.set(sessionId, session);

    // Connect server to transport
    await server.connect(transport);

    // Clean up session when transport closes
    transport.onclose = () => {
      sessions.delete(sessionId!);
    };
  }

  // Handle the request with raw Node.js objects (no third argument)
  await session.transport.handleRequest(req, res);
}

/**
 * Handle health check requests
 */
async function handleHealthCheck(
  res: ServerResponse,
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>
): Promise<void> {
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
}

/**
 * Handle readiness probe requests
 */
function handleReadyCheck(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready: true }));
}

/**
 * Handle 404 not found
 */
function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Create an HTTP transport for MCP protocol and health checks
 */
export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const { port, createMcpServer, onHealthCheck } = options;

  const httpServer = createServer();

  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || `localhost:${port}`}`);

    switch (url.pathname) {
      case '/mcp':
        await handleMcpRequest(req, res, createMcpServer);
        break;
      case '/health':
        if (req.method === 'GET') {
          await handleHealthCheck(res, onHealthCheck);
        } else {
          handleNotFound(res);
        }
        break;
      case '/ready':
        if (req.method === 'GET') {
          handleReadyCheck(res);
        } else {
          handleNotFound(res);
        }
        break;
      default:
        handleNotFound(res);
    }
  });

  return {
    server: httpServer,
    start: () => {
      return new Promise((resolve, reject) => {
        httpServer.on('error', reject);
        httpServer.listen(port, () => {
          resolve();
        });
      });
    },
    stop: () => {
      return new Promise((resolve, reject) => {
        // Close all active sessions
        for (const [sessionId, session] of sessions) {
          session.server.close().catch(() => {});
          sessions.delete(sessionId);
        }

        httpServer.close((err) => {
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
  options?: {
    createMcpServer?: () => McpServer;
    onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
  }
): HttpTransport {
  return createHttpTransport({
    port: config.httpPort,
    createMcpServer: options?.createMcpServer,
    onHealthCheck: options?.onHealthCheck,
  });
}
