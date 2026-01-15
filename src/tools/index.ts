/**
 * DNS Intel Tools
 *
 * This module exports all tools and their definitions for the MCP server.
 */

export { rdapLookup, rdapToolDefinition, rdapInputSchema } from './rdap.js';
export { dnsQuery, dnsToolDefinition, dnsInputSchema } from './dns.js';
export { ctSearch, ctToolDefinition, ctInputSchema } from './ct.js';

import { rdapToolDefinition } from './rdap.js';
import { dnsToolDefinition } from './dns.js';
import { ctToolDefinition } from './ct.js';
import type { ToolDefinition } from '../types.js';

/**
 * All tool definitions for MCP registration
 */
export const allToolDefinitions: ToolDefinition[] = [
  rdapToolDefinition,
  dnsToolDefinition,
  ctToolDefinition,
];
