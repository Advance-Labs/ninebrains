import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Brain } from '@ninebrains/brain-core';
import type { BrainMcpConfig } from './config';
import { registerTools } from './tools';

export const SERVER_NAME = 'ninebrains-brain';
export const SERVER_VERSION = '0.1.0';

const LANE_INSTRUCTIONS = `You are one lane of a Ninebrains workbench. A central Brain hands out jobs and coordinates lanes through these tools.
Loop: read_inbox -> claim_job -> do the work -> complete_job with a summary and evidence. If stuck, call block with what would unblock you.
Gate feedback and instructions arrive in your inbox. Use send_message to talk to other lanes or the Brain, add_note for durable findings.`;

const BRAIN_INSTRUCTIONS = `You are a Ninebrains Brain. You plan work as jobs with dependencies and coordinate the lanes that do it.
create_job and link_jobs build the plan; ready jobs are dispatched to idle lanes automatically, or use assign_job.
Watch read_inbox for lane reports, requeue_job blocked work once unblocked, and use list_lanes / list_jobs to see progress.`;

/** Builds an MCP server bound to one identity. Transport-agnostic: the bin connects stdio. */
export function createBrainMcpServer(options: { brain: Brain; config: BrainMcpConfig }): McpServer {
  const { brain, config } = options;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: config.identity.role === 'brain' ? BRAIN_INSTRUCTIONS : LANE_INSTRUCTIONS }
  );
  registerTools(server, brain, config);
  return server;
}
