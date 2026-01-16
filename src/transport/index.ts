/**
 * Transport layer for DNS Intel MCP server
 * HTTP-only transport for Dedalus platform compatibility
 */

export {
  createHttpTransport,
  createHttpTransportFromConfig,
  type HttpTransport,
  type HttpTransportOptions,
} from './http.js';
