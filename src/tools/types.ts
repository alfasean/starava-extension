import type { ToolSpec } from '../llm/types';

export interface ToolContext {
  signal?: AbortSignal;
  reportProgress(label: string): void;
}

export interface ToolDefinition {
  spec: ToolSpec;
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}
