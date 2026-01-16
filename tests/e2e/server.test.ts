import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Store original fetch for HTTP transport tests
const originalFetch = global.fetch;

// Mock fetch for tool tests
const mockFetch = vi.fn();

describe('MCP Server E2E', () => {
  beforeAll(() => {
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Tool listing', () => {
    it('should list all available tools', async () => {
      // Access internal handlers through simulated request
      const tools = [
        'rdap_lookup',
        'dns_query',
        'ct_search',
      ];

      // The server should have these tools available
      // We test this by checking the tool definitions
      const { allToolDefinitions } = await import('../../src/tools/index.js');
      expect(allToolDefinitions.map(t => t.name)).toEqual(tools);
    });

    it('should have correct tool schemas', async () => {
      const { allToolDefinitions } = await import('../../src/tools/index.js');

      // rdap_lookup
      const rdapTool = allToolDefinitions.find(t => t.name === 'rdap_lookup');
      expect(rdapTool).toBeDefined();
      expect(rdapTool?.inputSchema.properties).toHaveProperty('domain');
      expect(rdapTool?.inputSchema.required).toContain('domain');

      // dns_query
      const dnsTool = allToolDefinitions.find(t => t.name === 'dns_query');
      expect(dnsTool).toBeDefined();
      expect(dnsTool?.inputSchema.properties).toHaveProperty('name');
      expect(dnsTool?.inputSchema.properties).toHaveProperty('type');
      expect(dnsTool?.inputSchema.required).toContain('name');
      expect(dnsTool?.inputSchema.required).toContain('type');

      // ct_search
      const ctTool = allToolDefinitions.find(t => t.name === 'ct_search');
      expect(ctTool).toBeDefined();
      expect(ctTool?.inputSchema.properties).toHaveProperty('domain');
      expect(ctTool?.inputSchema.properties).toHaveProperty('limit');
      expect(ctTool?.inputSchema.properties).toHaveProperty('cursor');
      expect(ctTool?.inputSchema.required).toContain('domain');
    });
  });

  describe('Tool execution', () => {
    it('should execute rdap_lookup tool', async () => {
      const mockRdapResponse = {
        objectClassName: 'domain',
        ldhName: 'example.com',
        status: ['active'],
        events: [],
        entities: [],
        nameservers: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRdapResponse,
      });

      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.domain).toBe('example.com');
      }
    });

    it('should execute dns_query tool', async () => {
      const mockDohResponse = {
        Status: 0,
        Answer: [
          { name: 'example.com', type: 1, TTL: 300, data: '93.184.216.34' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDohResponse,
      });

      const { dnsQuery } = await import('../../src/tools/dns.js');
      const result = await dnsQuery({ name: 'example.com', type: 'A' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.records).toHaveLength(1);
      }
    });

    it('should execute ct_search tool', async () => {
      const mockCrtShResponse = [
        {
          id: 12345,
          issuer_ca_id: 1,
          issuer_name: "Let's Encrypt",
          common_name: 'example.com',
          name_value: 'example.com',
          not_before: '2024-01-01T00:00:00Z',
          not_after: '2024-04-01T00:00:00Z',
          serial_number: 'ABC123',
          entry_timestamp: '2024-01-01T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockCrtShResponse),
      });

      const { ctSearch } = await import('../../src/tools/ct.js');
      const result = await ctSearch({ domain: 'example.com' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.certificates).toHaveLength(1);
      }
    });
  });

  describe('Response envelope', () => {
    it('should return standard success envelope', async () => {
      const mockRdapResponse = {
        objectClassName: 'domain',
        ldhName: 'example.com',
        status: ['active'],
        events: [],
        entities: [],
        nameservers: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRdapResponse,
      });

      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'example.com' });

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');

      if (result.ok) {
        expect(result.meta).toHaveProperty('retrieved_at');
        expect(result.meta).toHaveProperty('source');
        expect(new Date(result.meta.retrieved_at).toISOString()).toBe(result.meta.retrieved_at);
      }
    });

    it('should return standard error envelope', async () => {
      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'invalid' });

      expect(result).toHaveProperty('ok', false);
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('meta');

      if (!result.ok) {
        expect(result.error).toHaveProperty('code');
        expect(result.error).toHaveProperty('message');
        expect(result.error).toHaveProperty('details');
        expect(result.meta).toHaveProperty('retrieved_at');
      }
    });

    it('should include pagination in CT responses', async () => {
      const mockCertificates = Array.from({ length: 150 }, (_, i) => ({
        id: i,
        issuer_ca_id: 1,
        issuer_name: 'Test CA',
        common_name: `cert${i}.example.com`,
        name_value: `cert${i}.example.com`,
        not_before: '2024-01-01T00:00:00Z',
        not_after: '2024-04-01T00:00:00Z',
        serial_number: `SERIAL${i}`,
        entry_timestamp: '2024-01-01T00:00:00Z',
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockCertificates),
      });

      const { ctSearch } = await import('../../src/tools/ct.js');
      const result = await ctSearch({ domain: 'example.com', limit: 100 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta).toHaveProperty('pagination');
        expect(result.meta.pagination).toHaveProperty('next_cursor');
        expect(result.meta.pagination?.next_cursor).not.toBeNull();
      }
    });
  });

  describe('Error handling', () => {
    it('should handle timeout errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('should handle upstream errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UPSTREAM_ERROR');
      }
    });

    it('should handle parse errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const { rdapLookup } = await import('../../src/tools/rdap.js');
      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });
  });
});

describe('HTTP Transport', () => {
  it('should create HTTP transport', async () => {
    const { createHttpTransport } = await import('../../src/transport/http.js');

    const transport = createHttpTransport({
      port: 3001,
      onHealthCheck: async () => ({ status: 'ok', checks: {} }),
    });

    expect(transport).toHaveProperty('server');
    expect(transport).toHaveProperty('start');
    expect(transport).toHaveProperty('stop');
  });

  it('should respond to health check', async () => {
    const { createHttpTransport } = await import('../../src/transport/http.js');

    const transport = createHttpTransport({
      port: 3002,
      onHealthCheck: async () => ({ status: 'ok', checks: { database: true } }),
    });

    await transport.start();

    // Use original fetch for real HTTP requests
    const response = await originalFetch('http://localhost:3002/health');
    const data = await response.json() as { status: string; checks: Record<string, boolean> };

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.checks.database).toBe(true);

    await transport.stop();
  });

  it('should respond to ready check', async () => {
    const { createHttpTransport } = await import('../../src/transport/http.js');

    const transport = createHttpTransport({
      port: 3003,
    });

    await transport.start();

    // Use original fetch for real HTTP requests
    const response = await originalFetch('http://localhost:3003/ready');
    const data = await response.json() as { ready: boolean };

    expect(response.status).toBe(200);
    expect(data.ready).toBe(true);

    await transport.stop();
  });
});
