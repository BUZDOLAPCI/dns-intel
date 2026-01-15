#!/usr/bin/env node

/**
 * DNS Intel MCP Server CLI
 *
 * This is the main entry point for running the MCP server.
 * It supports stdio transport (default) for MCP communication.
 */

import { createServer } from './server.js';
import { createStdioTransport } from './transport/stdio.js';
import { createHttpTransportFromConfig } from './transport/http.js';
import { getConfig, loadConfig } from './config.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  const showHelp = args.includes('--help') || args.includes('-h');
  const showVersion = args.includes('--version') || args.includes('-v');
  const enableHttp = args.includes('--http');

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  if (showVersion) {
    console.log('dns-intel v1.0.0');
    process.exit(0);
  }

  // Load configuration
  loadConfig();
  const config = getConfig();

  // Create and start server
  const server = createServer();

  // Handle graceful shutdown
  const shutdown = async () => {
    console.error('[INFO] Shutting down...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start HTTP health check server if enabled
  if (enableHttp) {
    const httpTransport = createHttpTransportFromConfig(config, async () => ({
      status: 'ok',
      checks: {
        server: true,
      },
    }));

    await httpTransport.start();
    console.error(`[INFO] HTTP health check server listening on port ${config.httpPort}`);
  }

  // Connect stdio transport
  const transport = createStdioTransport();

  console.error('[INFO] DNS Intel MCP server starting...');
  console.error(`[INFO] Log level: ${config.logLevel}`);
  console.error(`[INFO] Default resolver: ${config.defaultResolver}`);
  console.error(`[INFO] Request timeout: ${config.requestTimeoutMs}ms`);

  await server.connect(transport);

  console.error('[INFO] Server connected and ready');
}

function printHelp(): void {
  console.log(`
DNS Intel MCP Server - Domain intelligence via RDAP, DNS, and Certificate Transparency

USAGE:
  dns-intel [OPTIONS]

OPTIONS:
  -h, --help      Show this help message
  -v, --version   Show version information
  --http          Enable HTTP health check server

ENVIRONMENT VARIABLES:
  DNS_RESOLVER         Default DNS resolver (default: 8.8.8.8)
  REQUEST_TIMEOUT_MS   Request timeout in milliseconds (default: 10000)
  HTTP_PORT            HTTP server port for health checks (default: 3000)
  LOG_LEVEL            Log level: debug, info, warn, error (default: info)

TOOLS:
  rdap_lookup    Query RDAP for domain registration information
  dns_query      Perform DNS queries (A, AAAA, CNAME, TXT, MX, NS, SOA)
  ct_search      Search Certificate Transparency logs

EXAMPLES:
  # Start server in stdio mode (default)
  dns-intel

  # Start with HTTP health checks enabled
  dns-intel --http

  # With custom DNS resolver
  DNS_RESOLVER=1.1.1.1 dns-intel

For more information, visit: https://github.com/dedalus-labs/dns-intel
`);
}

// Run the main function
main().catch((error) => {
  console.error('[FATAL] Server failed to start:', error);
  process.exit(1);
});
