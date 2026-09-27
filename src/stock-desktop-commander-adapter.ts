import './bootstrap.js';

import { executeStockToolCall } from './stock-tool-dispatcher.js';
import { listStockTools } from './stock-tool-catalog.js';
import { configManager } from './config-manager.js';
import { runInUiOriginCallContext } from './utils/capture.js';
import {
  runWithToolCallRuntimeContext,
  setCurrentClient,
  type RuntimeClientInfo,
} from './runtime-context.js';
import type { ServerResult } from './types.js';

export interface DirectToolCall {
  name: string;
  arguments?: unknown;
  metadata?: {
    remote?: boolean;
    clientInfo?: RuntimeClientInfo;
  };
}

export interface StockDesktopCommanderInitializeOptions {
  clientInfo?: RuntimeClientInfo;
  remote?: boolean;
}

const PILOT_TOOLS = new Set([
  'list_directory',
  'read_file',
  'get_file_info',
]);

export class StockDesktopCommanderAdapter {
  private ready = false;
  private shuttingDown = false;
  private defaultRemote = false;
  private defaultClientInfo: RuntimeClientInfo | null = null;
  private activeCalls = new Set<Promise<ServerResult>>();

  async initialize(options: StockDesktopCommanderInitializeOptions = {}): Promise<void> {
    if (this.ready) return;
    if (this.shuttingDown) {
      throw new Error('Stock Desktop Commander adapter is shutting down');
    }

    this.defaultRemote = options.remote === true;
    this.defaultClientInfo = options.clientInfo ?? null;
    if (options.clientInfo) {
      setCurrentClient(options.clientInfo);
    }

    // Configuration is required by the stock handlers and is process-wide.
    // Feature flags are intentionally NOT owned by this adapter: remote adapter
    // restarts must not create/destroy process-wide network refresh state.
    try {
      await configManager.loadConfig();
    } catch (error) {
      // Stock index.ts continues with in-memory configuration if initialization
      // fails. Preserve that behavior for the direct execution path.
      console.error(
        'Direct Desktop Commander initialization warning:',
        error instanceof Error ? error.message : String(error),
      );
    }

    this.ready = true;
  }

  async health(): Promise<{ ready: boolean; reason?: string }> {
    if (this.shuttingDown) {
      return { ready: false, reason: 'shutting_down' };
    }
    return this.ready ? { ready: true } : { ready: false, reason: 'not_initialized' };
  }

  async listTools(clientInfo: RuntimeClientInfo | null = this.defaultClientInfo) {
    if (!this.ready || this.shuttingDown) {
      return { tools: [] };
    }
    return listStockTools(clientInfo ?? undefined);
  }

  async callTool(request: DirectToolCall): Promise<ServerResult> {
    if (!this.ready || this.shuttingDown) {
      return {
        content: [{ type: 'text', text: 'Error: Stock Desktop Commander adapter is not ready' }],
        isError: true,
      };
    }

    const remote = request.metadata?.remote ?? this.defaultRemote;
    const remoteClient = remote
      ? (request.metadata?.clientInfo ?? { name: 'remote-unknown', version: 'unknown' })
      : null;

    const execute = async (): Promise<ServerResult> => executeStockToolCall({
      name: request.name,
      arguments: request.arguments,
      metadata: request.metadata as Record<string, unknown> | undefined,
    });

    const run = () => {
      const args = request.arguments;
      const isUiOrigin = !!(
        args
        && typeof args === 'object'
        && (args as { origin?: unknown }).origin === 'ui'
      );
      return isUiOrigin
        ? runInUiOriginCallContext(execute)
        : execute();
    };

    const call = runWithToolCallRuntimeContext(
      { remote, remoteClient },
      run,
    );
    this.activeCalls.add(call);
    try {
      return await call;
    } finally {
      this.activeCalls.delete(call);
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.ready = false;

    const active = [...this.activeCalls];
    if (active.length > 0) {
      // Full runtime teardown must not race an already-admitted stock call.
      // The integration seals/kills process-owning managers first so process
      // calls unblock, then waits here until every admitted call settles.
      await Promise.allSettled(active);
    }
  }

  get pilotToolNames(): string[] {
    return [...PILOT_TOOLS];
  }
}
