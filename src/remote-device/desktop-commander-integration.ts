import { StockDesktopCommanderAdapter } from '../stock-desktop-commander-adapter.js';
import { captureRemote } from '../utils/capture.js';
import { featureFlagManager } from '../utils/feature-flags.js';
import { configManager } from '../config-manager.js';
import { searchManager } from '../search-manager.js';
import { terminalManager } from '../terminal-manager.js';
import { toolHistory } from '../utils/toolHistory.js';

const RESTART_BACKOFF_CAP_MS = 5_000;
const restartBackoffMs = (attempt: number) =>
    Math.min(
        RESTART_BACKOFF_CAP_MS,
        250 * 2 ** Math.min(attempt, 5) * (0.5 + Math.random()),
    );

type DirectAdapter = StockDesktopCommanderAdapter;

export class DesktopCommanderIntegration {
    private adapter: DirectAdapter | null = null;
    private isReady = false;
    private isShuttingDown = false;
    private disconnectHandler: ((reason: string) => void) | null = null;
    private reinitPromise: Promise<void> | null = null;
    private restartAttempts = 0;
    private nextRestartAt = 0;
    private processRuntimeInitialized = false;

    get ready(): boolean {
        return this.isReady && this.adapter !== null;
    }

    onDisconnect(handler: (reason: string) => void) {
        this.disconnectHandler = handler;
    }

    protected createAdapter(): DirectAdapter {
        return new StockDesktopCommanderAdapter();
    }

    private abortIfShuttingDown(): void {
        if (this.isShuttingDown) {
            throw new Error('Desktop Commander integration is shutting down');
        }
    }

    private async initializeProcessRuntime(): Promise<void> {
        if (this.processRuntimeInitialized) return;
        terminalManager.initialize();
        searchManager.initialize();
        await featureFlagManager.initialize();
        this.processRuntimeInitialized = true;
    }

    private async startAdapter(): Promise<void> {
        this.abortIfShuttingDown();
        await this.initializeProcessRuntime();

        const candidate = this.createAdapter();

        try {
            await candidate.initialize({
                clientInfo: {
                    name: 'desktop-commander-client',
                    version: '1.0.0',
                },
                remote: true,
            });
            this.abortIfShuttingDown();

            const health = await candidate.health();
            if (!health.ready) {
                throw new Error(
                    `Direct Desktop Commander adapter is not ready${health.reason ? `: ${health.reason}` : ''}`,
                );
            }

            const listed = await candidate.listTools();
            if (!Array.isArray(listed.tools) || listed.tools.length === 0) {
                throw new Error('Direct Desktop Commander adapter returned no tools');
            }

            this.abortIfShuttingDown();

            this.adapter = candidate;
            this.isReady = true;
            this.restartAttempts = 0;
            this.nextRestartAt = 0;

            console.log(` - 🔌 Direct Desktop Commander execution ready (${listed.tools.length} tools)`);
        } catch (error) {
            this.isReady = false;
            if (this.adapter === candidate) {
                this.adapter = null;
            }
            await candidate.shutdown().catch(() => { });
            await captureRemote('desktop_integration_init_failed', { error });
            throw error;
        }
    }

    async initialize(): Promise<void> {
        await this.ensureReady();
    }

    async ensureReady(): Promise<void> {
        if (this.ready) return;

        if (this.isShuttingDown) {
            throw new Error('Desktop Commander integration is shutting down');
        }

        const waitMs = this.nextRestartAt - Date.now();
        if (waitMs > 0) {
            throw new Error(
                `Direct Desktop Commander execution failed to initialize ${this.restartAttempts} time(s); ` +
                `next attempt in ${Math.ceil(waitMs / 1000)}s`,
            );
        }

        if (!this.reinitPromise) {
            this.reinitPromise = (async () => {
                try {
                    await this.discardAdapter();
                    await this.startAdapter();
                } catch (error) {
                    this.restartAttempts++;
                    this.nextRestartAt = Date.now() + restartBackoffMs(this.restartAttempts);
                    throw error;
                }
            })().finally(() => {
                this.reinitPromise = null;
            });
        }

        await this.reinitPromise;
    }

    private async discardAdapter(): Promise<void> {
        const current = this.adapter;
        this.adapter = null;
        this.isReady = false;

        if (current) {
            try {
                await current.shutdown();
            } catch (error) {
                await captureRemote('desktop_integration_shutdown_error', {
                    error,
                    component: 'direct-adapter',
                });
            }
        }
    }

    private async markUnhealthy(reason: string): Promise<void> {
        if (this.isShuttingDown || !this.isReady) return;

        this.isReady = false;
        await captureRemote('desktop_integration_local_disconnected', { reason });
        this.disconnectHandler?.(reason);
    }

    get msUntilRestartAllowed(): number {
        return Math.max(0, this.nextRestartAt - Date.now());
    }

    async callClientTool(toolName: string, args: any, metadata?: any) {
        await this.ensureReady();

        const adapter = this.adapter;
        if (!adapter) {
            throw new Error('Direct Desktop Commander adapter is not available');
        }

        try {
            return await adapter.callTool({
                name: toolName,
                arguments: args,
                metadata: {
                    remote: true,
                    ...(metadata || {}),
                },
            });
        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            await captureRemote('desktop_integration_tool_call_failed', { error, toolName });

            try {
                const health = await adapter.health();
                if (!health.ready) {
                    await this.markUnhealthy(
                        `direct adapter unhealthy${health.reason ? `: ${health.reason}` : ''}`,
                    );
                }
            } catch {
                await this.markUnhealthy('direct adapter health check failed');
            }

            throw error;
        }
    }

    async listClientTools() {
        if (!this.ready || !this.adapter) {
            return { tools: [] };
        }

        try {
            return await this.adapter.listTools();
        } catch (error) {
            console.error('Error fetching direct Desktop Commander capabilities:', error);
            await captureRemote('desktop_integration_list_tools_failed', { error });
            return { tools: [] };
        }
    }

    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            if (this.reinitPromise) {
                await this.reinitPromise.catch(() => { });
            }
            return;
        }

        this.isShuttingDown = true;

        if (this.reinitPromise) {
            await this.reinitPromise.catch(() => { });
        }

        const current = this.adapter;
        this.adapter = null;
        this.isReady = false;
        const adapterShutdown = current
            ? current.shutdown().catch(async (error) => {
                await captureRemote('desktop_integration_shutdown_error', {
                    error,
                    component: 'direct-adapter',
                });
            })
            : Promise.resolve();

        if (this.processRuntimeInitialized) {
            // Direct mode moved the stock runtime into this process. Stop the
            // process-owning managers before draining the adapter so long-lived
            // terminal/search calls are released instead of surviving teardown.
            await terminalManager.shutdown().catch(async (error) => {
                await captureRemote('desktop_integration_shutdown_error', {
                    error,
                    component: 'terminal-manager',
                });
            });
            await searchManager.shutdown().catch(async (error) => {
                await captureRemote('desktop_integration_shutdown_error', {
                    error,
                    component: 'search-manager',
                });
            });
            await adapterShutdown;
            await toolHistory.cleanup().catch(async (error) => {
                await captureRemote('desktop_integration_shutdown_error', {
                    error,
                    component: 'tool-history',
                });
            });
            featureFlagManager.destroy();
            await configManager.shutdown();
            this.processRuntimeInitialized = false;
        } else {
            await adapterShutdown;
        }

        console.debug('[DEBUG] Direct Desktop Commander integration shutdown complete');
    }
}
