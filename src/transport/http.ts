import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import type { ServerConfig } from '../types.js';
import { rdapLookup, dnsQuery, ctSearch, allToolDefinitions } from '../tools/index.js';
import { getConfig } from '../config.js';

/**
 * JSON-RPC 2.0 request type
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response type
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * HTTP transport for MCP protocol and health checks
 *
 * This HTTP server provides:
 * - /mcp endpoint for stateless MCP JSON-RPC protocol
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
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
}

/**
 * Handle a single JSON-RPC request
 */
async function handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'dns-intel',
              version: '1.0.0',
            },
          },
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: allToolDefinitions,
          },
        };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const args = params?.arguments as Record<string, unknown>;

        let result: unknown;

        switch (toolName) {
          case 'rdap_lookup': {
            const domain = args?.domain as string;
            result = await rdapLookup({ domain });
            break;
          }

          case 'dns_query': {
            const name = args?.name as string;
            const type = args?.type as 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SOA';
            const resolver = args?.resolver as string | undefined;
            result = await dnsQuery({ name, type, resolver });
            break;
          }

          case 'ct_search': {
            const domain = args?.domain as string;
            const limit = args?.limit as number | undefined;
            const cursor = args?.cursor as string | null | undefined;
            result = await ctSearch({ domain, limit, cursor });
            break;
          }

          default:
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${message}`,
      },
    };
  }
}

/**
 * Read the request body as a string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

/**
 * Handle health check endpoint
 */
async function handleHealthCheck(
  res: ServerResponse,
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>
): Promise<void> {
  try {
    const health = onHealthCheck
      ? await onHealthCheck()
      : { status: 'ok', checks: {} };
    sendJson(res, 200, health);
  } catch (error) {
    sendJson(res, 500, {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Handle readiness probe endpoint
 */
function handleReadyCheck(res: ServerResponse): void {
  sendJson(res, 200, { ready: true });
}

/**
 * Handle not found
 */
function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

/**
 * Handle method not allowed
 */
function handleMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed' });
}

/**
 * Handle MCP JSON-RPC endpoint
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const request: JsonRpcRequest = JSON.parse(body);

    if (!request.jsonrpc || request.jsonrpc !== '2.0') {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: request.id || 0,
        error: {
          code: -32600,
          message: 'Invalid Request: missing or invalid jsonrpc version',
        },
      });
      return;
    }

    const response = await handleJsonRpcRequest(request);
    sendJson(res, 200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendJson(res, 500, {
      jsonrpc: '2.0',
      id: 0,
      error: {
        code: -32700,
        message: `Parse error: ${message}`,
      },
    });
  }
}

/**
 * Create an HTTP transport for MCP protocol and health checks
 */
export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const { port, onHealthCheck } = options;

  const httpServer = createServer();

  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || `localhost:${port}`}`);
    const method = req.method?.toUpperCase();

    try {
      switch (url.pathname) {
        case '/mcp':
          if (method === 'POST') {
            await handleMcpRequest(req, res);
          } else {
            handleMethodNotAllowed(res);
          }
          break;

        case '/health':
          if (method === 'GET') {
            await handleHealthCheck(res, onHealthCheck);
          } else {
            handleMethodNotAllowed(res);
          }
          break;

        case '/ready':
          if (method === 'GET') {
            handleReadyCheck(res);
          } else {
            handleMethodNotAllowed(res);
          }
          break;

        default:
          handleNotFound(res);
      }
    } catch (error) {
      console.error('Server error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  return {
    server: httpServer,
    start: () => {
      return new Promise((resolve, reject) => {
        httpServer.on('error', reject);
        httpServer.listen(port, () => {
          console.log(`dns-intel HTTP server listening on http://localhost:${port}`);
          console.log(`MCP endpoint: http://localhost:${port}/mcp`);
          console.log(`Health check: http://localhost:${port}/health`);
          resolve();
        });
      });
    },
    stop: () => {
      return new Promise((resolve, reject) => {
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
  config?: ServerConfig,
  options?: {
    onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
  }
): HttpTransport {
  const cfg = config ?? getConfig();
  return createHttpTransport({
    port: cfg.httpPort,
    onHealthCheck: options?.onHealthCheck,
  });
}
