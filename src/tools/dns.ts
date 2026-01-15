import { z } from 'zod';
import { getConfig } from '../config.js';
import type {
  Response,
  DnsData,
  DnsInput,
  DnsRecordType,
  DnsRecord,
  DohResponse,
  MxRecord,
  SoaRecord,
  ToolDefinition,
} from '../types.js';

/**
 * DNS record type to numeric type mapping (for DoH)
 */
const DNS_TYPE_MAP: Record<DnsRecordType, number> = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  TXT: 16,
  MX: 15,
  NS: 2,
  SOA: 6,
};

/**
 * Reverse mapping from numeric type to string
 */
const DNS_TYPE_REVERSE: Record<number, DnsRecordType> = {
  1: 'A',
  28: 'AAAA',
  5: 'CNAME',
  16: 'TXT',
  15: 'MX',
  2: 'NS',
  6: 'SOA',
};

/**
 * Input validation schema for dns_query
 */
export const dnsInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
      'Invalid DNS name format'
    ),
  type: z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SOA']),
  resolver: z
    .string()
    .regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, 'Invalid resolver IP address')
    .optional(),
});

/**
 * Tool definition for MCP registration
 */
export const dnsToolDefinition: ToolDefinition = {
  name: 'dns_query',
  description:
    'Perform DNS queries for various record types. Supports A, AAAA, CNAME, TXT, MX, NS, and SOA records.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The DNS name to query (e.g., "example.com")',
      },
      type: {
        type: 'string',
        enum: ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SOA'],
        description: 'The DNS record type to query',
      },
      resolver: {
        type: 'string',
        description: 'Optional custom DNS resolver IP (default: 8.8.8.8)',
      },
    },
    required: ['name', 'type'],
  },
};

/**
 * DNS-over-HTTPS endpoints for different resolvers
 */
const DOH_ENDPOINTS: Record<string, string> = {
  '8.8.8.8': 'https://dns.google/resolve',
  '8.8.4.4': 'https://dns.google/resolve',
  '1.1.1.1': 'https://cloudflare-dns.com/dns-query',
  '1.0.0.1': 'https://cloudflare-dns.com/dns-query',
  '9.9.9.9': 'https://dns.quad9.net/dns-query',
};

/**
 * Perform DNS query using DNS-over-HTTPS
 */
export async function dnsQuery(input: DnsInput): Promise<Response<DnsData>> {
  const now = new Date().toISOString();
  const config = getConfig();

  // Validate input
  const validation = dnsInputSchema.safeParse(input);
  if (!validation.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: validation.error.errors.map((e) => e.message).join(', '),
        details: { errors: validation.error.errors },
      },
      meta: { retrieved_at: now },
    };
  }

  const { name, type } = validation.data;
  const resolver = validation.data.resolver ?? config.defaultResolver;

  try {
    // Get DoH endpoint for resolver
    const dohEndpoint = DOH_ENDPOINTS[resolver] ?? DOH_ENDPOINTS['8.8.8.8'] ?? 'https://dns.google/resolve';

    // Build query URL
    const queryUrl = new URL(dohEndpoint);
    queryUrl.searchParams.set('name', name);
    queryUrl.searchParams.set('type', String(DNS_TYPE_MAP[type]));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(queryUrl.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/dns-json',
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'DNS resolver rate limit exceeded',
            details: { status: response.status, resolver },
          },
          meta: { retrieved_at: now },
        };
      }
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `DNS query failed with status ${response.status}`,
          details: { status: response.status, resolver },
        },
        meta: { retrieved_at: now },
      };
    }

    let dohData: DohResponse;
    try {
      dohData = (await response.json()) as DohResponse;
    } catch {
      return {
        ok: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'Failed to parse DNS response as JSON',
          details: {},
        },
        meta: { retrieved_at: now },
      };
    }

    // Check DNS status
    if (dohData.Status !== 0) {
      const statusMessages: Record<number, string> = {
        1: 'Format error',
        2: 'Server failure',
        3: 'Non-existent domain (NXDOMAIN)',
        4: 'Not implemented',
        5: 'Query refused',
      };
      const message = statusMessages[dohData.Status] ?? `DNS error code ${dohData.Status}`;
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message,
          details: { dns_status: dohData.Status },
        },
        meta: { retrieved_at: now },
      };
    }

    // Parse records
    const records = parseRecords(dohData.Answer ?? [], type);

    const warnings: string[] = [];
    if (records.length === 0) {
      warnings.push(`No ${type} records found for ${name}`);
    }

    return {
      ok: true,
      data: {
        name,
        type,
        resolver,
        records,
      },
      meta: {
        source: dohEndpoint,
        retrieved_at: now,
        warnings,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `DNS query timed out after ${config.requestTimeoutMs}ms`,
          details: { timeout_ms: config.requestTimeoutMs },
        },
        meta: { retrieved_at: now },
      };
    }

    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: { error: String(error) },
      },
      meta: { retrieved_at: now },
    };
  }
}

/**
 * Parse DNS answer records into structured format
 */
function parseRecords(
  answers: NonNullable<DohResponse['Answer']>,
  requestedType: DnsRecordType
): DnsRecord[] {
  return answers
    .filter((answer) => {
      const type = DNS_TYPE_REVERSE[answer.type];
      return type === requestedType;
    })
    .map((answer) => {
      const type = DNS_TYPE_REVERSE[answer.type];
      if (!type) {
        return null;
      }

      const record: DnsRecord = {
        name: answer.name,
        type,
        ttl: answer.TTL,
        data: parseRecordData(type, answer.data),
      };

      return record;
    })
    .filter((r): r is DnsRecord => r !== null);
}

/**
 * Parse record data based on type
 */
function parseRecordData(
  type: DnsRecordType,
  data: string
): string | MxRecord | SoaRecord {
  switch (type) {
    case 'MX': {
      // MX format: "priority exchange"
      const parts = data.split(' ');
      const priority = parseInt(parts[0] ?? '0', 10);
      const exchange = parts.slice(1).join(' ').replace(/\.$/, '');
      return { priority, exchange } as MxRecord;
    }

    case 'SOA': {
      // SOA format: "mname rname serial refresh retry expire minimum"
      const parts = data.split(' ');
      return {
        mname: (parts[0] ?? '').replace(/\.$/, ''),
        rname: (parts[1] ?? '').replace(/\.$/, ''),
        serial: parseInt(parts[2] ?? '0', 10),
        refresh: parseInt(parts[3] ?? '0', 10),
        retry: parseInt(parts[4] ?? '0', 10),
        expire: parseInt(parts[5] ?? '0', 10),
        minimum: parseInt(parts[6] ?? '0', 10),
      } as SoaRecord;
    }

    case 'TXT':
      // Remove surrounding quotes if present
      return data.replace(/^"(.*)"$/, '$1');

    case 'CNAME':
    case 'NS':
      // Remove trailing dot
      return data.replace(/\.$/, '');

    default:
      return data;
  }
}
