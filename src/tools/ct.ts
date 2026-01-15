import { z } from 'zod';
import { getConfig } from '../config.js';
import type {
  Response,
  CtData,
  CtInput,
  CtCertificate,
  CrtShEntry,
  ToolDefinition,
} from '../types.js';

/**
 * Default and maximum limits for CT search
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * Input validation schema for ct_search
 */
export const ctInputSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Invalid domain format'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_LIMIT),
  cursor: z.string().nullable().optional(),
});

/**
 * Tool definition for MCP registration
 */
export const ctToolDefinition: ToolDefinition = {
  name: 'ct_search',
  description:
    'Search Certificate Transparency logs for certificates issued for a domain. Uses crt.sh API to find historical and current certificates.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The domain to search for certificates (e.g., "example.com")',
      },
      limit: {
        type: 'number',
        description: `Maximum number of certificates to return (1-${MAX_LIMIT}, default: ${DEFAULT_LIMIT})`,
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor for fetching more results',
        nullable: true,
      },
    },
    required: ['domain'],
  },
};

/**
 * crt.sh API base URL
 */
const CRTSH_API_URL = 'https://crt.sh';

/**
 * Search Certificate Transparency logs
 */
export async function ctSearch(input: CtInput): Promise<Response<CtData>> {
  const now = new Date().toISOString();
  const config = getConfig();

  // Validate input
  const validation = ctInputSchema.safeParse(input);
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

  const { domain, limit } = validation.data;
  const cursor = validation.data.cursor ?? null;

  // Parse cursor to get offset
  let offset = 0;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as {
        offset?: number;
      };
      offset = parsed.offset ?? 0;
    } catch {
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid pagination cursor',
          details: {},
        },
        meta: { retrieved_at: now },
      };
    }
  }

  try {
    // Build query URL with wildcard search
    const queryUrl = new URL(CRTSH_API_URL);
    queryUrl.searchParams.set('q', `%.${domain}`);
    queryUrl.searchParams.set('output', 'json');

    const controller = new AbortController();
    // crt.sh can be slow, use longer timeout
    const timeoutMs = Math.max(config.requestTimeoutMs, 30000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(queryUrl.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'dns-intel-mcp/1.0',
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
            message: 'crt.sh rate limit exceeded. Please try again later.',
            details: { status: response.status },
          },
          meta: { retrieved_at: now },
        };
      }
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `crt.sh query failed with status ${response.status}`,
          details: { status: response.status },
        },
        meta: { retrieved_at: now },
      };
    }

    let rawData: CrtShEntry[];
    try {
      const text = await response.text();
      // Handle empty response
      if (!text || text.trim() === '') {
        rawData = [];
      } else {
        rawData = JSON.parse(text) as CrtShEntry[];
      }
    } catch {
      return {
        ok: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'Failed to parse crt.sh response as JSON',
          details: {},
        },
        meta: { retrieved_at: now },
      };
    }

    // Apply pagination (offset and limit)
    const totalAvailable = rawData.length;
    const paginatedData = rawData.slice(offset, offset + limit);

    // Transform to our certificate format
    const certificates = paginatedData.map(transformCertificate);

    // Calculate next cursor
    const nextOffset = offset + limit;
    const hasMore = nextOffset < totalAvailable;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64')
      : null;

    const warnings: string[] = [];
    if (certificates.length === 0 && offset === 0) {
      warnings.push(`No certificates found for ${domain}`);
    }

    return {
      ok: true,
      data: {
        domain,
        certificates,
        total_returned: certificates.length,
      },
      meta: {
        source: 'crt.sh',
        retrieved_at: now,
        pagination: {
          next_cursor: nextCursor,
        },
        warnings,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: 'crt.sh query timed out. The service may be slow - please try again.',
          details: { timeout_ms: Math.max(config.requestTimeoutMs, 30000) },
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
 * Transform crt.sh entry to our certificate format
 */
function transformCertificate(entry: CrtShEntry): CtCertificate {
  return {
    id: entry.id,
    issuer_ca_id: entry.issuer_ca_id,
    issuer_name: entry.issuer_name,
    common_name: entry.common_name,
    name_value: entry.name_value,
    not_before: entry.not_before,
    not_after: entry.not_after,
    serial_number: entry.serial_number,
    entry_timestamp: entry.entry_timestamp,
  };
}
