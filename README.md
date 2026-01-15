# DNS Intel MCP Server

Domain intelligence MCP server providing RDAP lookups, DNS queries, and Certificate Transparency log searches.

## Features

- **RDAP Lookup**: Query domain registration information (registrar, dates, nameservers, status)
- **DNS Query**: Perform DNS queries for A, AAAA, CNAME, TXT, MX, NS, and SOA records
- **CT Search**: Search Certificate Transparency logs for certificates issued for a domain

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server (stdio)

```bash
# Start the server
npm start

# Or with custom configuration
DNS_RESOLVER=1.1.1.1 npm start
```

### With Claude Desktop

Add to your Claude Desktop configuration (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dns-intel": {
      "command": "node",
      "args": ["/path/to/dns-intel/dist/cli.js"]
    }
  }
}
```

### With HTTP Health Checks

For containerized deployments, enable the HTTP health check server:

```bash
npm start -- --http
```

This exposes:
- `GET /health` - Health check endpoint
- `GET /ready` - Readiness probe

## Tools

### rdap_lookup

Query RDAP for domain registration information.

**Input:**
```json
{
  "domain": "example.com"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "domain": "example.com",
    "registrar": "Example Registrar Inc.",
    "creation_date": "1995-08-14T04:00:00Z",
    "expiration_date": "2025-08-13T04:00:00Z",
    "updated_date": "2024-08-14T07:01:34Z",
    "status": ["clientDeleteProhibited", "clientTransferProhibited"],
    "nameservers": ["a.iana-servers.net", "b.iana-servers.net"]
  },
  "meta": {
    "source": "rdap-bootstrap.iana.org",
    "retrieved_at": "2024-01-15T10:30:00Z"
  }
}
```

### dns_query

Perform DNS queries for various record types.

**Input:**
```json
{
  "name": "example.com",
  "type": "MX",
  "resolver": "8.8.8.8"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "name": "example.com",
    "type": "MX",
    "resolver": "8.8.8.8",
    "records": [
      {
        "name": "example.com",
        "type": "MX",
        "ttl": 300,
        "data": {
          "priority": 10,
          "exchange": "mail.example.com"
        }
      }
    ]
  },
  "meta": {
    "source": "https://dns.google/resolve",
    "retrieved_at": "2024-01-15T10:30:00Z"
  }
}
```

**Supported Record Types:**
- `A` - IPv4 address
- `AAAA` - IPv6 address
- `CNAME` - Canonical name
- `TXT` - Text records
- `MX` - Mail exchange
- `NS` - Nameserver
- `SOA` - Start of authority

### ct_search

Search Certificate Transparency logs for certificates.

**Input:**
```json
{
  "domain": "example.com",
  "limit": 100,
  "cursor": null
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "domain": "example.com",
    "certificates": [
      {
        "id": 12345678,
        "issuer_ca_id": 16418,
        "issuer_name": "C=US, O=Let's Encrypt, CN=R3",
        "common_name": "*.example.com",
        "name_value": "example.com\n*.example.com",
        "not_before": "2024-01-01T00:00:00",
        "not_after": "2024-04-01T00:00:00",
        "serial_number": "abc123...",
        "entry_timestamp": "2024-01-01T00:00:01"
      }
    ],
    "total_returned": 1
  },
  "meta": {
    "source": "crt.sh",
    "retrieved_at": "2024-01-15T10:30:00Z",
    "pagination": {
      "next_cursor": "eyJvZmZzZXQiOjEwMH0="
    }
  }
}
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DNS_RESOLVER` | `8.8.8.8` | Default DNS resolver for queries |
| `REQUEST_TIMEOUT_MS` | `10000` | Request timeout in milliseconds |
| `HTTP_PORT` | `3000` | HTTP server port for health checks |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## Response Format

All tools return a standard response envelope:

### Success Response

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "source": "...",
    "retrieved_at": "2024-01-15T10:30:00Z",
    "pagination": { "next_cursor": null },
    "warnings": []
  }
}
```

### Error Response

```json
{
  "ok": false,
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "Human readable error message",
    "details": { ... }
  },
  "meta": {
    "retrieved_at": "2024-01-15T10:30:00Z"
  }
}
```

**Error Codes:**
- `INVALID_INPUT` - Invalid input parameters
- `UPSTREAM_ERROR` - Error from upstream service
- `RATE_LIMITED` - Rate limit exceeded
- `TIMEOUT` - Request timed out
- `PARSE_ERROR` - Failed to parse response
- `INTERNAL_ERROR` - Internal server error

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Build
npm run build
```

## License

MIT
