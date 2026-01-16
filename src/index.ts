/**
 * DNS Intel MCP Server
 *
 * Domain intelligence via RDAP, DNS, and Certificate Transparency search.
 *
 * @packageDocumentation
 */

// Server
export {
  createServer,
  createStandaloneServer,
  type StandaloneServer,
  type StandaloneServerOptions,
} from './server.js';

// Tools
export {
  rdapLookup,
  rdapToolDefinition,
  rdapInputSchema,
  dnsQuery,
  dnsToolDefinition,
  dnsInputSchema,
  ctSearch,
  ctToolDefinition,
  ctInputSchema,
  allToolDefinitions,
} from './tools/index.js';

// Transport
export {
  createStdioTransport,
  createHttpTransport,
  createHttpTransportFromConfig,
  type HttpTransport,
  type HttpTransportOptions,
} from './transport/index.js';

// Config
export { loadConfig, getConfig, setConfig } from './config.js';

// Types
export type {
  // Response envelope
  Response,
  SuccessResponse,
  ErrorResponse,
  ResponseMeta,
  ErrorCode,
  // RDAP
  RdapInput,
  RdapData,
  // DNS
  DnsInput,
  DnsData,
  DnsRecord,
  DnsRecordType,
  MxRecord,
  SoaRecord,
  // CT
  CtInput,
  CtData,
  CtCertificate,
  // Server
  ServerConfig,
  ToolDefinition,
} from './types.js';
