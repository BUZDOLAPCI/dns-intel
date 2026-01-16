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
    it('should respond to tools/list JSON-RPC request (stateless)', async () => {
      // Stateless MCP - no session required, each request is independent
      const response = await httpRequest({
        port: TEST_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(response.status).toBe(200);

      const data = JSON.parse(response.body);
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(1);
      expect(data.result).toBeDefined();
      expect(data.result.tools).toBeDefined();
      expect(Array.isArray(data.result.tools)).toBe(true);

      // Verify our tools are listed
      const toolNames = data.result.tools.map((t: { name: string }) => t.name);
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

      const data = JSON.parse(response.body);
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(1);
      expect(data.result).toBeDefined();
      expect(data.result.serverInfo?.name).toBe('dns-intel');
      expect(data.result.serverInfo?.version).toBe('1.0.0');
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
