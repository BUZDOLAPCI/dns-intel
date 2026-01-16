import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createStandaloneServer } from '../../src/server.js';
import type { StandaloneServer } from '../../src/server.js';

// Helper function to make HTTP requests without relying on global fetch
function httpRequest(
  options: {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('HTTP Transport', () => {
  let server: StandaloneServer;
  const TEST_PORT = 18080;

  beforeAll(async () => {
    server = createStandaloneServer({ port: TEST_PORT });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('/mcp endpoint', () => {
    it('should respond to tools/list JSON-RPC request after initialization', async () => {
      // First, initialize a session
      const initResponse = await httpRequest({
        port: TEST_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      expect(initResponse.status).toBe(200);

      // Get the session ID from the response header
      const sessionId = initResponse.headers['mcp-session-id'] as string;
      expect(sessionId).toBeDefined();

      // Now make the tools/list request with the session ID
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(response.status).toBe(200);

      const text = response.body;
      // StreamableHTTPServerTransport may return multiple JSON objects or SSE format
      // Parse the response to find the JSON-RPC result
      const lines = text.split('\n').filter((line) => line.trim());

      let result: { tools?: Array<{ name: string }> } | null = null;
      for (const line of lines) {
        try {
          // Try to parse as JSON directly or as SSE data
          const jsonStr = line.startsWith('data:') ? line.substring(5).trim() : line;
          const parsed = JSON.parse(jsonStr);
          if (parsed.result?.tools || parsed.tools) {
            result = parsed.result || parsed;
            break;
          }
        } catch {
          // Continue trying other lines
        }
      }

      expect(result).not.toBeNull();
      expect(result?.tools).toBeDefined();
      expect(Array.isArray(result?.tools)).toBe(true);

      // Verify our tools are listed
      const toolNames = result?.tools?.map((t: { name: string }) => t.name) || [];
      expect(toolNames).toContain('rdap_lookup');
      expect(toolNames).toContain('dns_query');
      expect(toolNames).toContain('ct_search');
    });

    it('should handle initialize request and return server info', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      expect(response.status).toBe(200);

      const text = response.body;
      // Parse the response to find server info
      const lines = text.split('\n').filter((line) => line.trim());

      let result: { serverInfo?: { name: string; version: string } } | null = null;
      for (const line of lines) {
        try {
          const jsonStr = line.startsWith('data:') ? line.substring(5).trim() : line;
          const parsed = JSON.parse(jsonStr);
          if (parsed.result?.serverInfo) {
            result = parsed.result;
            break;
          }
        } catch {
          // Continue trying other lines
        }
      }

      expect(result).not.toBeNull();
      expect(result?.serverInfo?.name).toBe('dns-intel');
      expect(result?.serverInfo?.version).toBe('1.0.0');
    });
  });

  describe('/health endpoint', () => {
    it('should return health status', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/health',
      });

      expect(response.status).toBe(200);

      const data = JSON.parse(response.body);
      expect(data.status).toBe('ok');
      expect(data.checks).toBeDefined();
    });
  });

  describe('/ready endpoint', () => {
    it('should return ready status', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/ready',
      });

      expect(response.status).toBe(200);

      const data = JSON.parse(response.body);
      expect(data.ready).toBe(true);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/health',
      });

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should handle OPTIONS preflight request', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/mcp',
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/unknown',
      });

      expect(response.status).toBe(404);

      const data = JSON.parse(response.body);
      expect(data.error).toBe('Not found');
    });
  });
});
