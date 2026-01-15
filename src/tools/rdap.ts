import { z } from 'zod';
import { getConfig } from '../config.js';
import type {
  Response,
  RdapData,
  RdapInput,
  RdapRawResponse,
  RdapEntity,
  RdapEvent,
  ToolDefinition,
} from '../types.js';

/**
 * Input validation schema for rdap_lookup
 */
export const rdapInputSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Invalid domain format'
    ),
});

/**
 * Tool definition for MCP registration
 */
export const rdapToolDefinition: ToolDefinition = {
  name: 'rdap_lookup',
  description:
    'Query RDAP (Registration Data Access Protocol) for domain registration information including registrar, creation/expiry dates, nameservers, and status.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The domain name to look up (e.g., "example.com")',
      },
    },
    required: ['domain'],
  },
};

/**
 * IANA RDAP bootstrap URL
 */
const RDAP_BOOTSTRAP_URL = 'https://rdap-bootstrap.iana.org/domain';

/**
 * Perform RDAP lookup for a domain
 */
export async function rdapLookup(input: RdapInput): Promise<Response<RdapData>> {
  const now = new Date().toISOString();
  const config = getConfig();

  // Validate input
  const validation = rdapInputSchema.safeParse(input);
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

  const domain = validation.data.domain.toLowerCase();

  try {
    // Query IANA bootstrap to get the appropriate RDAP server
    const bootstrapUrl = `${RDAP_BOOTSTRAP_URL}/${encodeURIComponent(domain)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(bootstrapUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/rdap+json, application/json',
        },
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 404) {
        return {
          ok: false,
          error: {
            code: 'UPSTREAM_ERROR',
            message: `Domain not found in RDAP: ${domain}`,
            details: { status: response.status, domain },
          },
          meta: { retrieved_at: now },
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'RDAP server rate limit exceeded',
            details: { status: response.status },
          },
          meta: { retrieved_at: now },
        };
      }
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `RDAP query failed with status ${response.status}`,
          details: { status: response.status },
        },
        meta: { retrieved_at: now },
      };
    }

    let rdapData: RdapRawResponse;
    try {
      rdapData = (await response.json()) as RdapRawResponse;
    } catch {
      return {
        ok: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'Failed to parse RDAP response as JSON',
          details: {},
        },
        meta: { retrieved_at: now },
      };
    }

    // Extract relevant information from RDAP response
    const data = parseRdapResponse(domain, rdapData);

    return {
      ok: true,
      data,
      meta: {
        source: 'rdap-bootstrap.iana.org',
        retrieved_at: now,
        warnings: [],
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `RDAP query timed out after ${config.requestTimeoutMs}ms`,
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
 * Parse raw RDAP response into structured data
 */
function parseRdapResponse(domain: string, raw: RdapRawResponse): RdapData {
  // Extract registrar from entities
  const registrar = extractRegistrar(raw.entities);

  // Extract dates from events
  const events = raw.events ?? [];
  const creationDate = findEventDate(events, 'registration');
  const expirationDate = findEventDate(events, 'expiration');
  const updatedDate = findEventDate(events, 'last changed');

  // Extract status
  const status = raw.status ?? [];

  // Extract nameservers
  const nameservers = (raw.nameservers ?? [])
    .map((ns) => ns.ldhName)
    .filter((ns): ns is string => !!ns)
    .map((ns) => ns.toLowerCase());

  return {
    domain,
    registrar,
    creation_date: creationDate,
    expiration_date: expirationDate,
    updated_date: updatedDate,
    status,
    nameservers,
  };
}

/**
 * Extract registrar name from RDAP entities
 */
function extractRegistrar(entities: RdapEntity[] | undefined): string | null {
  if (!entities) return null;

  for (const entity of entities) {
    if (entity.roles?.includes('registrar')) {
      // Try to get name from vcard
      if (entity.vcardArray) {
        const vcard = entity.vcardArray[1];
        if (vcard) {
          for (const field of vcard) {
            if (field[0] === 'fn' && typeof field[3] === 'string') {
              return field[3];
            }
          }
        }
      }
      // Fall back to handle
      if (entity.handle) {
        return entity.handle;
      }
    }

    // Check nested entities
    const nestedRegistrar = extractRegistrar(entity.entities);
    if (nestedRegistrar) return nestedRegistrar;
  }

  return null;
}

/**
 * Find event date by action type
 */
function findEventDate(events: RdapEvent[], action: string): string | null {
  const event = events.find(
    (e) => e.eventAction?.toLowerCase() === action.toLowerCase()
  );
  return event?.eventDate ?? null;
}
