import path from 'path';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListPromptsRequestSchema,
    InitializeRequestSchema,
    LATEST_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    type CallToolRequest,
    type InitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getSystemInfo, getOSSpecificGuidance, getPathGuidance, getDevelopmentToolGuidance } from './utils/system-info.js';

// Get system information once at startup
const SYSTEM_INFO = getSystemInfo();
const OS_GUIDANCE = getOSSpecificGuidance(SYSTEM_INFO);
const DEV_TOOL_GUIDANCE = getDevelopmentToolGuidance(SYSTEM_INFO);
const PATH_GUIDANCE = `IMPORTANT: ${getPathGuidance(SYSTEM_INFO)} Relative paths may fail as they depend on the current working directory. Tilde paths (~/...) might not work in all contexts. Unless the user explicitly asks for relative paths, use absolute paths.`;

const CMD_PREFIX_DESCRIPTION = `This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.`;

import {
    StartProcessArgsSchema,
    ReadProcessOutputArgsSchema,
    InteractWithProcessArgsSchema,
    ForceTerminateArgsSchema,
    ListSessionsArgsSchema,
    KillProcessArgsSchema,
    ReadFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    CreateDirectoryArgsSchema,
    ListDirectoryArgsSchema,
    MoveFileArgsSchema,
    GetFileInfoArgsSchema,
    GetConfigArgsSchema,
    SetConfigValueArgsSchema,
    ListProcessesArgsSchema,
    EditBlockArgsSchema,
    GetUsageStatsArgsSchema,
    GiveFeedbackArgsSchema,
    StartSearchArgsSchema,
    GetMoreSearchResultsArgsSchema,
    StopSearchArgsSchema,
    ListSearchesArgsSchema,
    GetPromptsArgsSchema,
    GetRecentToolCallsArgsSchema,
    WritePdfArgsSchema,
    toolArgSchemas,
} from './tools/schemas.js';
import {
    detectUnsupportedParams,
    getSupportedParams,
    buildUnsupportedParamsWarning,
} from './utils/unsupportedParams.js';
import { getConfig, setConfigValue } from './tools/config.js';
import { getUsageStats } from './tools/usage.js';
import { giveFeedbackToDesktopCommander } from './tools/feedback.js';
import { getPrompts } from './tools/prompts.js';
import { trackToolCall } from './utils/trackTools.js';
import { usageTracker } from './utils/usageTracker.js';
import { processDockerPrompt } from './utils/dockerPrompt.js';
import { toolHistory } from './utils/toolHistory.js';
import { handleWelcomePageOnboarding, skipWelcomePageOnboarding } from './utils/welcome-onboarding.js';

import { VERSION } from './version.js';
import { capture, capture_call_tool, runInUiOriginCallContext } from "./utils/capture.js";
import { logToStderr, logger } from './utils/logger.js';
import {
    buildUiToolMeta,
    CONFIG_EDITOR_RESOURCE_URI,
    FILE_PREVIEW_RESOURCE_URI,
} from './ui/contracts.js';
import { listUiResources, readUiResource } from './ui/resources.js';
import { shouldShowMcpUiPreviews } from './utils/mcp-ui-ab-test.js';
import { executeStockToolCall } from './stock-tool-dispatcher.js';
import { listStockTools } from './stock-tool-catalog.js';
import {
    currentClient,
    getCurrentCallIsRemote,
    getCurrentRemoteClient,
    runWithToolCallRuntimeContext,
    setCurrentClient,
} from './runtime-context.js';

// Store startup messages to send after initialization
const deferredMessages: Array<{ level: string, message: string }> = [];
function deferLog(level: string, message: string) {
    deferredMessages.push({ level, message });
}

// Function to flush deferred messages after initialization
export function flushDeferredMessages() {
    while (deferredMessages.length > 0) {
        const msg = deferredMessages.shift()!;
        logger.info(msg.message);
    }
}

deferLog('info', 'Loading server.ts');

export const server = new Server(
    {
        name: "desktop-commander",
        version: VERSION,
    },
    {
        capabilities: {
            tools: {},
            resources: {},  // Add empty resources capability
            prompts: {},    // Add empty prompts capability
            logging: {},    // Add logging capability for console redirection
        },
    },
);

// Add handler for resources/list method
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: listUiResources(),
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const response = await readUiResource(uri);
    if (response) {
        return response;
    }

    throw new Error(`Unknown resource URI: ${uri}`);
});

// Add handler for prompts/list method
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    // Return an empty list of prompts
    return {
        prompts: [],
    };
});

// Store current client info (simple variable)


// Tracks whether the in-flight tool call originated from a remote device.
// Mirrors the module-level `currentClient` pattern so that telemetry events
// emitted deeper inside tool handlers (e.g. server_start_process,
// server_read_file) can be attributed to the remote path. The CallTool
// handler sets this on every call (true when _meta.remote is present,
// false otherwise) so the flag never leaks from a remote call to a
// subsequent local call.


/**
 * Set whether the current tool call is from a remote device.
 * Called once per tool call by the CallTool handler.
 */


// The remote caller's client for the in-flight tool call (e.g. openai-mcp,
// claude-ai). Set per CallTool when the call is remote; null for local calls.
// Mirrors currentCallIsRemote so telemetry attributes remote events to the
// actual remote client instead of the device's own currentClient (which stays
// LOCAL and must not be polluted by remote callers).


/**
 * Set the remote caller's client for the current tool call (null when local).
 * Called once per tool call by the CallTool handler.
 */


/**
 * True when this server instance is serving remote services rather than a
 * local MCP client. The remote-device wrapper marks the server it spawns with
 * DC_REMOTE_DEVICE=true (see remote-device/desktop-commander-integration.ts);
 * the client-name check covers older wrappers that predate the env marker.
 */
function isRemoteClientContext(clientName?: string): boolean {
    return process.env.DC_REMOTE_DEVICE === 'true' || clientName === 'desktop-commander-client';
}

/**
 * Unified way to update client information
 */
async function updateCurrentClient(clientInfo: { name?: string, version?: string }) {
    if (clientInfo.name !== currentClient.name || clientInfo.version !== currentClient.version) {
        const nameChanged = clientInfo.name !== currentClient.name;

        setCurrentClient({
            name: clientInfo.name || currentClient.name,
            version: clientInfo.version || currentClient.version
        });

        // Configure transport for client-specific behavior only if name changed
        if (nameChanged) {
            const transport = (global as any).mcpTransport;
            if (transport && typeof transport.configureForClient === 'function') {
                transport.configureForClient(currentClient.name);
            }
        }

        return true;
    }
    return false;
}

// Add handler for initialization method - capture client info
server.setRequestHandler(InitializeRequestSchema, async (request: InitializeRequest) => {
    try {
        // Extract and store current client information
        const clientInfo = request.params?.clientInfo;
        if (clientInfo) {
            await updateCurrentClient(clientInfo);

            // Welcome page for new users (A/B test controlled) — all clients except
            // the Desktop Commander app and remote contexts. Further exclusions are
            // flag-served via welcome_page_excluded_clients (e.g. claude-code, which
            // covers Claude Code and Cowork plugin sessions — both identify as
            // `claude-code` and provide their own onboarding surface).
            const isWelcomePageEligibleClient = currentClient.name !== 'desktop-commander-app'
                && currentClient.name !== 'desktop-commander'
                && !isRemoteClientContext(currentClient.name)
                && !(global as any).disableOnboarding;

            if (isWelcomePageEligibleClient) {
                await handleWelcomePageOnboarding(currentClient.name);
            } else {
                // Do not carry a first-run page over to a client that is made
                // eligible in a later release.
                await skipWelcomePageOnboarding();
            }
        }

        // Raw host environment signals (no PII, undefined when absent). Some
        // hosts share a clientInfo name — Claude Code CLI, Claude Code inside
        // the Claude Desktop app, and Cowork all report 'claude-code' — and
        // these let analytics tell them apart without client-specific
        // branching in code. Verified signatures: CLI → entrypoint 'cli';
        // CC-in-desktop → entrypoint 'claude-desktop'; Cowork → no
        // entrypoint/agent, plugin id 'desktop-commander-inline'.
        // Values truncated to GA4's 100-char param limit (same convention as
        // containerName/containerImage) so an oversized value can never get
        // the whole event rejected.
        capture('run_server_mcp_initialized', {
            host_entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT?.substring(0, 100),
            host_agent: process.env.AI_AGENT?.substring(0, 100),
            host_plugin_id: process.env.CLAUDE_PLUGIN_DATA
                ? path.basename(process.env.CLAUDE_PLUGIN_DATA).substring(0, 100) : undefined
        });

        // Negotiate protocol version with client
        const requestedVersion = request.params?.protocolVersion;
        const protocolVersion = (requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion))
            ? requestedVersion
            : LATEST_PROTOCOL_VERSION;

        // Return standard initialization response
        return {
            protocolVersion,
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {},
            },
            serverInfo: {
                name: "desktop-commander",
                version: VERSION,
            },
        };
    } catch (error) {
        logToStderr('error', `Error in initialization handler: ${error}`);
        throw error;
    }
});

// Export current client info for access by other modules
export { currentClient } from './runtime-context.js';

deferLog('info', 'Setting up request handlers...');

server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
        return await listStockTools(currentClient);
    } catch (error) {
        logToStderr('error', `Error in list_tools request handler: ${error}`);
        throw error;
    }
});

import * as handlers from './handlers/index.js';
import { ServerResult } from './types.js';

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<ServerResult> => {
    const args = request.params.arguments;
    const metadata = request.params._meta as any;
    const isRemoteCall = !!(metadata && typeof metadata === 'object' && metadata.remote);
    const remoteClient = isRemoteCall
        ? (
            metadata.clientInfo && (metadata.clientInfo.name || metadata.clientInfo.version)
                ? metadata.clientInfo
                : { name: 'remote-unknown', version: 'unknown' }
        )
        : null;

    const execute = () => {
        // Calls fired programmatically by the widget UIs (file preview, config
        // editor) carry origin:'ui'. They are real tool executions but not agent
        // actions, so they must produce zero telemetry.
        const isUiOriginCall = !!(args && typeof args === 'object' && (args as any).origin === 'ui');
        const dispatch = () => executeStockToolCall({
            name: request.params.name,
            arguments: request.params.arguments,
            metadata: request.params._meta as Record<string, unknown> | undefined,
        });
        if (isUiOriginCall) {
            return runInUiOriginCallContext(dispatch);
        }
        return dispatch();
    };

    return runWithToolCallRuntimeContext(
        { remote: isRemoteCall, remoteClient },
        execute,
    );
});

// Add no-op handlers so Visual Studio initialization succeeds
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));