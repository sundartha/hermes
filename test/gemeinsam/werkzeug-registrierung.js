import { registerTools } from "../../src/mcp-tools.js";

function subfieldsOf(node) {
  const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
  return Object.entries(inner?.shape ?? {});
}

function collectInto(descriptions, { name, description, schema }) {
  descriptions.set(name, description || "");
  for (const [field, node] of Object.entries(schema || {})) {
    descriptions.set(`${name}.${field}`, node?.description || "");
    for (const [sub, subNode] of subfieldsOf(node)) descriptions.set(`${name}.${field}.${sub}`, subNode?.description || "");
  }
}

export function captureToolDescriptions(ctx) {
  const descriptions = new Map();
  const fakeServer = {
    tool: (name, description, schema) => collectInto(descriptions, { name, description, schema }),
    registerTool: (name, config) => collectInto(descriptions, { name, description: config.description, schema: config.inputSchema }),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return descriptions;
}

export function captureToolHandlers(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool: (name, _config, handler) => handlers.set(name, handler),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}
