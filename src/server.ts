import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import {
  rdapLookup,
  dnsQuery,
  ctSearch,
  allToolDefinitions,
} from './tools/index.js';
import type {
  RdapInput,
  DnsInput,
  CtInput,
  Response,
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
 * Server instance type export
 */
export type { Server };
