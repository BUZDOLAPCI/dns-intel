/**
 * Standard response envelope types for DNS Intel MCP server
 */

// ============================================================================
// Standard Response Envelope
// ============================================================================

export interface SuccessResponse<T> {
  ok: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
  meta: {
    retrieved_at: string;
  };
}

export type Response<T> = SuccessResponse<T> | ErrorResponse;

export interface ResponseMeta {
  source?: string;
  retrieved_at: string;
  pagination?: {
    next_cursor: string | null;
  };
  warnings?: string[];
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'INTERNAL_ERROR';

// ============================================================================
// RDAP Types
// ============================================================================

export interface RdapInput {
  domain: string;
}

export interface RdapData {
  domain: string;
  registrar: string | null;
  creation_date: string | null;
  expiration_date: string | null;
  updated_date: string | null;
  status: string[];
  nameservers: string[];
}

// Raw RDAP response types
export interface RdapRawResponse {
  objectClassName?: string;
  handle?: string;
  ldhName?: string;
  links?: Array<{
    rel?: string;
    href?: string;
    type?: string;
  }>;
  status?: string[];
  entities?: RdapEntity[];
  events?: RdapEvent[];
  nameservers?: Array<{
    objectClassName?: string;
    ldhName?: string;
  }>;
  secureDNS?: {
    delegationSigned?: boolean;
  };
}

export interface RdapEntity {
  objectClassName?: string;
  handle?: string;
  roles?: string[];
  publicIds?: Array<{
    type?: string;
    identifier?: string;
  }>;
  vcardArray?: [string, Array<[string, Record<string, unknown>, string, string | string[]]>];
  entities?: RdapEntity[];
}

export interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

// ============================================================================
// DNS Types
// ============================================================================

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SOA';

export interface DnsInput {
  name: string;
  type: DnsRecordType;
  resolver?: string;
}

export interface DnsRecord {
  name: string;
  type: DnsRecordType;
  ttl: number;
  data: string | MxRecord | SoaRecord;
}

export interface MxRecord {
  priority: number;
  exchange: string;
}

export interface SoaRecord {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

export interface DnsData {
  name: string;
  type: DnsRecordType;
  resolver: string;
  records: DnsRecord[];
}

// DNS-over-HTTPS response types
export interface DohResponse {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: Array<{
    name: string;
    type: number;
  }>;
  Answer?: Array<{
    name: string;
    type: number;
    TTL: number;
    data: string;
  }>;
  Authority?: Array<{
    name: string;
    type: number;
    TTL: number;
    data: string;
  }>;
}

// ============================================================================
// Certificate Transparency Types
// ============================================================================

export interface CtInput {
  domain: string;
  limit?: number;
  cursor?: string | null;
}

export interface CtCertificate {
  id: number;
  issuer_ca_id: number;
  issuer_name: string;
  common_name: string;
  name_value: string;
  not_before: string;
  not_after: string;
  serial_number: string;
  entry_timestamp: string;
}

export interface CtData {
  domain: string;
  certificates: CtCertificate[];
  total_returned: number;
}

// Raw crt.sh response
export interface CrtShEntry {
  id: number;
  issuer_ca_id: number;
  issuer_name: string;
  common_name: string;
  name_value: string;
  not_before: string;
  not_after: string;
  serial_number: string;
  entry_timestamp: string;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerConfig {
  defaultResolver: string;
  requestTimeoutMs: number;
  httpPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
