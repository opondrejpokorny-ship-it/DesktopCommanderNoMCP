import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeClientInfo {
  name?: string;
  version?: string;
}

export interface ToolCallRuntimeContext {
  remote: boolean;
  remoteClient: RuntimeClientInfo | null;
}

// The connected local MCP client is process-wide state. This intentionally
// remains a live binding because server initialization updates it rarely and
// existing configuration/telemetry code reads it outside individual calls.
export let currentClient: RuntimeClientInfo = {
  name: 'uninitialized',
  version: 'uninitialized',
};

const toolCallContext = new AsyncLocalStorage<ToolCallRuntimeContext>();

export function setCurrentClient(clientInfo: RuntimeClientInfo): void {
  currentClient = {
    name: clientInfo.name ?? currentClient.name,
    version: clientInfo.version ?? currentClient.version,
  };
}

export function getCurrentCallIsRemote(): boolean {
  return toolCallContext.getStore()?.remote === true;
}

export function getCurrentRemoteClient(): RuntimeClientInfo | null {
  return toolCallContext.getStore()?.remoteClient ?? null;
}

export function runWithToolCallRuntimeContext<T>(
  context: ToolCallRuntimeContext,
  fn: () => T,
): T {
  return toolCallContext.run(context, fn);
}
