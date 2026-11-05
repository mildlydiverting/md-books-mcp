#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(
    [
      `md-books-mcp ${VERSION}`,
      "",
      "An MCP server for finding books and making citations.",
      "Speaks stdio; run it from an MCP client rather than directly.",
      "",
      "Environment (set in your MCP client's env block):",
      "  GOOGLE_BOOKS_API_KEY   required for the Google Books source",
      "",
    ].join("\n"),
  );
} else {
  serveStdio(() => {
    const server = new McpServer({ name: "md-books-mcp", version: VERSION });
    registerTools(server);
    return server;
  });
  // stdout carries the protocol; diagnostics go to stderr.
  console.error(`md-books-mcp ${VERSION} running on stdio`);
}
