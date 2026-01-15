import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rdapLookup, rdapInputSchema } from '../../src/tools/rdap.js';
import { dnsQuery, dnsInputSchema } from '../../src/tools/dns.js';
import { ctSearch, ctInputSchema } from '../../src/tools/ct.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RDAP Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rdapInputSchema', () => {
    it('should validate correct domain', () => {
      const result = rdapInputSchema.safeParse({ domain: 'example.com' });
      expect(result.success).toBe(true);
    });

    it('should reject empty domain', () => {
      const result = rdapInputSchema.safeParse({ domain: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid domain format', () => {
      const result = rdapInputSchema.safeParse({ domain: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should accept subdomain', () => {
      const result = rdapInputSchema.safeParse({ domain: 'sub.example.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('rdapLookup', () => {
    it('should return domain registration data on success', async () => {
      const mockRdapResponse = {
        objectClassName: 'domain',
        ldhName: 'example.com',
        status: ['active'],
        events: [
          { eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
          { eventAction: 'expiration', eventDate: '2025-01-01T00:00:00Z' },
        ],
        entities: [
          {
            roles: ['registrar'],
            vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]],
          },
        ],
        nameservers: [
          { ldhName: 'ns1.example.com' },
          { ldhName: 'ns2.example.com' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRdapResponse,
      });

      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.domain).toBe('example.com');
        expect(result.data.status).toEqual(['active']);
        expect(result.data.registrar).toBe('Example Registrar');
        expect(result.data.nameservers).toEqual(['ns1.example.com', 'ns2.example.com']);
        expect(result.meta.source).toBe('rdap-bootstrap.iana.org');
      }
    });

    it('should return error for invalid domain', async () => {
      const result = await rdapLookup({ domain: 'invalid' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should handle 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await rdapLookup({ domain: 'notfound.example' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UPSTREAM_ERROR');
        expect(result.error.message).toContain('not found');
      }
    });

    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await rdapLookup({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});

describe('DNS Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('dnsInputSchema', () => {
    it('should validate correct input', () => {
      const result = dnsInputSchema.safeParse({ name: 'example.com', type: 'A' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid record type', () => {
      const result = dnsInputSchema.safeParse({ name: 'example.com', type: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should accept optional resolver', () => {
      const result = dnsInputSchema.safeParse({
        name: 'example.com',
        type: 'A',
        resolver: '1.1.1.1',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid resolver IP', () => {
      const result = dnsInputSchema.safeParse({
        name: 'example.com',
        type: 'A',
        resolver: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dnsQuery', () => {
    it('should return A records on success', async () => {
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

      const result = await dnsQuery({ name: 'example.com', type: 'A' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('example.com');
        expect(result.data.type).toBe('A');
        expect(result.data.records).toHaveLength(1);
        expect(result.data.records[0]?.data).toBe('93.184.216.34');
      }
    });

    it('should return MX records with priority', async () => {
      const mockDohResponse = {
        Status: 0,
        Answer: [
          { name: 'example.com', type: 15, TTL: 300, data: '10 mail.example.com.' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDohResponse,
      });

      const result = await dnsQuery({ name: 'example.com', type: 'MX' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.records[0]?.data).toEqual({
          priority: 10,
          exchange: 'mail.example.com',
        });
      }
    });

    it('should handle NXDOMAIN response', async () => {
      const mockDohResponse = {
        Status: 3, // NXDOMAIN
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDohResponse,
      });

      const result = await dnsQuery({ name: 'nonexistent.example', type: 'A' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UPSTREAM_ERROR');
        expect(result.error.message).toContain('NXDOMAIN');
      }
    });

    it('should return warning for no records', async () => {
      const mockDohResponse = {
        Status: 0,
        Answer: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDohResponse,
      });

      const result = await dnsQuery({ name: 'example.com', type: 'AAAA' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.records).toHaveLength(0);
        expect(result.meta.warnings).toContain('No AAAA records found for example.com');
      }
    });

    it('should return error for invalid input', async () => {
      const result = await dnsQuery({ name: '', type: 'A' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });
  });
});

describe('CT Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ctInputSchema', () => {
    it('should validate correct domain', () => {
      const result = ctInputSchema.safeParse({ domain: 'example.com' });
      expect(result.success).toBe(true);
    });

    it('should accept optional limit', () => {
      const result = ctInputSchema.safeParse({ domain: 'example.com', limit: 50 });
      expect(result.success).toBe(true);
    });

    it('should reject limit above maximum', () => {
      const result = ctInputSchema.safeParse({ domain: 'example.com', limit: 2000 });
      expect(result.success).toBe(false);
    });

    it('should accept null cursor', () => {
      const result = ctInputSchema.safeParse({ domain: 'example.com', cursor: null });
      expect(result.success).toBe(true);
    });
  });

  describe('ctSearch', () => {
    it('should return certificates on success', async () => {
      const mockCrtShResponse = [
        {
          id: 12345,
          issuer_ca_id: 1,
          issuer_name: "Let's Encrypt",
          common_name: '*.example.com',
          name_value: 'example.com\n*.example.com',
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

      const result = await ctSearch({ domain: 'example.com' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.domain).toBe('example.com');
        expect(result.data.certificates).toHaveLength(1);
        expect(result.data.certificates[0]?.issuer_name).toBe("Let's Encrypt");
        expect(result.meta.source).toBe('crt.sh');
      }
    });

    it('should handle pagination', async () => {
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

      const result = await ctSearch({ domain: 'example.com', limit: 100 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.certificates).toHaveLength(100);
        expect(result.meta.pagination?.next_cursor).not.toBeNull();
      }
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

      const result = await ctSearch({ domain: 'nonexistent.example' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.certificates).toHaveLength(0);
        expect(result.meta.warnings).toContain('No certificates found for nonexistent.example');
      }
    });

    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const result = await ctSearch({ domain: 'example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('should return error for invalid domain', async () => {
      const result = await ctSearch({ domain: 'invalid' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should handle cursor pagination correctly', async () => {
      const mockCertificates = Array.from({ length: 200 }, (_, i) => ({
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

      // Create cursor for offset 100
      const cursor = Buffer.from(JSON.stringify({ offset: 100 })).toString('base64');

      const result = await ctSearch({ domain: 'example.com', cursor });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should return items starting from index 100
        expect(result.data.certificates[0]?.id).toBe(100);
        expect(result.data.certificates).toHaveLength(100);
        expect(result.meta.pagination?.next_cursor).toBeNull(); // No more items
      }
    });

    it('should reject invalid cursor', async () => {
      const result = await ctSearch({
        domain: 'example.com',
        cursor: 'invalid-cursor',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).toContain('cursor');
      }
    });
  });
});
