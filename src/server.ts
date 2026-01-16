import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig, loadConfig } from './config.js';
import {
  rdapLookup,
  dnsQuery,
  ctSearch,
  allToolDefinitions,
} from './tools/index.js';
import { createHttpTransportFromConfig, type HttpTransport } from './transport/http.js';
import type {
  RdapInput,
  DnsInput,
  CtInput,
  Response,
  ServerConfig,
} from './types.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const config = getConfig();

  const server = new Server(
    {
      name: 'dns-intel',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allToolDefinitions,
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (config.logLevel === 'debug') {
      console.error(`[DEBUG] Tool called: ${name}`, JSON.stringify(args));
    }

    let result: Response<unknown>;

    switch (name) {
      case 'rdap_lookup':
        result = await rdapLookup(args as unknown as RdapInput);
        break;

      case 'dns_query':
        result = await dnsQuery(args as unknown as DnsInput);
        break;

      case 'ct_search':
        result = await ctSearch(args as unknown as CtInput);
        break;

      default:
        result = {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: `Unknown tool: ${name}`,
            details: { available_tools: allToolDefinitions.map((t) => t.name) },
          },
          meta: {
            retrieved_at: new Date().toISOString(),
          },
        };
    }

    // Return the result as tool content
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  // Error handler
  server.onerror = (error) => {
    console.error('[ERROR] MCP Server error:', error);
  };

  return server;
}

/**
 * Standalone server configuration options
 */
export interface StandaloneServerOptions {
  port?: number;
  onHealthCheck?: () => Promise<{ status: string; checks: Record<string, boolean> }>;
}

/**
 * Standalone server instance
 */
export interface StandaloneServer {
  httpTransport: HttpTransport;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Create a standalone HTTP server for MCP protocol
 *
 * This creates an HTTP server that handles MCP requests at /mcp endpoint
 * using StreamableHTTPServerTransport with raw Node.js request/response objects.
 *
 * @example
 * ```typescript
 * const server = createStandaloneServer({ port: 3000 });
 * await server.start();
 * console.log('MCP server listening on port 3000');
 * ```
 */
export function createStandaloneServer(options: StandaloneServerOptions = {}): StandaloneServer {
  // Load config if not already loaded
  loadConfig();
  const config = getConfig();

  // Override port if provided
  const serverConfig: ServerConfig = {
    ...config,
    httpPort: options.port ?? config.httpPort,
  };

  const httpTransport = createHttpTransportFromConfig(serverConfig, {
    createMcpServer: createServer,
    onHealthCheck: options.onHealthCheck ?? (async () => ({
      status: 'ok',
      checks: {
        server: true,
      },
    })),
  });

  return {
    httpTransport,
    start: async () => {
      await httpTransport.start();
      console.error(`[INFO] DNS Intel MCP HTTP server listening on port ${serverConfig.httpPort}`);
      console.error(`[INFO] MCP endpoint: http://localhost:${serverConfig.httpPort}/mcp`);
      console.error(`[INFO] Health endpoint: http://localhost:${serverConfig.httpPort}/health`);
    },
    stop: async () => {
      await httpTransport.stop();
      console.error('[INFO] Server stopped');
    },
  };
}

/**
 * Server instance type export
 */
export type { Server };
