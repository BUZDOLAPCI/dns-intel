import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Create a stdio transport for MCP communication
 *
 * This transport uses stdin/stdout for communication, which is the
 * standard way for MCP servers to communicate with clients like Claude.
 */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export { StdioServerTransport };
