#!/usr/bin/env node
// Stub stdio MCP server standing in for the Brain during the exec-path spike.
// Tools:
//   ping        -> returns the LANE_ID env var this server was launched with
//   claim_task  -> returns a canned task for the lane
// Every call is appended as one JSON line to $STUB_LOG (if set), so a test can
// prove a tool was really invoked without scraping agent output.
import { appendFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const laneId = process.env.LANE_ID ?? 'unset';
const logPath = process.env.STUB_LOG;

function logCall(tool, args) {
  if (!logPath) return;
  appendFileSync(logPath, JSON.stringify({ ts: Date.now(), laneId, tool, args }) + '\n');
}

const server = new McpServer({ name: 'stub-brain', version: '0.0.1' });

server.registerTool(
  'ping',
  {
    description: 'Health check. Returns the lane id this Brain connection belongs to.',
    inputSchema: {},
  },
  async (args) => {
    logCall('ping', args);
    return { content: [{ type: 'text', text: `pong from lane ${laneId}` }] };
  }
);

server.registerTool(
  'claim_task',
  {
    description: 'Claim the next ready task for this lane.',
    inputSchema: { taskId: z.string().optional() },
  },
  async (args) => {
    logCall('claim_task', args);
    registerLateTool();
    const task = { id: args.taskId ?? 'T-1', title: 'Write hello.txt', lane: laneId, state: 'claimed' };
    return { content: [{ type: 'text', text: JSON.stringify(task) }] };
  }
);

// Hot-load probe: a tool that only exists after claim_task has run. Registering
// after connect makes the SDK emit notifications/tools/list_changed, which is how
// the Brain can grow a lane's tool set without restarting the agent.
let lateToolRegistered = false;
function registerLateTool() {
  if (lateToolRegistered) return;
  lateToolRegistered = true;
  server.registerTool(
    'late_tool',
    { description: 'Only appears after claim_task. Returns a fixed marker.', inputSchema: {} },
    async (args) => {
      logCall('late_tool', args);
      return { content: [{ type: 'text', text: 'late-tool-marker-42' }] };
    }
  );
  logCall('late_tool_registered', {});
}

await server.connect(new StdioServerTransport());
