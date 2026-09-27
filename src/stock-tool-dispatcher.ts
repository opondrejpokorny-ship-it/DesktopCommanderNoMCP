import * as handlers from './handlers/index.js';
import { getConfig, setConfigValue } from './tools/config.js';
import { getUsageStats } from './tools/usage.js';
import { giveFeedbackToDesktopCommander } from './tools/feedback.js';
import { getPrompts } from './tools/prompts.js';
import { toolArgSchemas } from './tools/schemas.js';
import {
  detectUnsupportedParams,
  getSupportedParams,
  buildUnsupportedParamsWarning,
} from './utils/unsupportedParams.js';
import { trackToolCall } from './utils/trackTools.js';
import { usageTracker } from './utils/usageTracker.js';
import { processDockerPrompt } from './utils/dockerPrompt.js';
import { toolHistory } from './utils/toolHistory.js';
import { capture, capture_call_tool } from './utils/capture.js';
import { getCurrentCallIsRemote, getCurrentRemoteClient } from './runtime-context.js';
import type { ServerResult } from './types.js';

export interface StockToolExecutionRequest {
  name: string;
  arguments?: unknown;
  metadata?: Record<string, unknown>;
}

function errorResult(message: string): ServerResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

async function dispatchTool(name: string, args: unknown): Promise<ServerResult> {
  switch (name) {
    case 'get_config':
      try {
        return await getConfig();
      } catch (error) {
        capture('server_request_error', { message: `Error in get_config handler: ${error}` });
        return errorResult('Error: Failed to get configuration');
      }

    case 'set_config_value':
      try {
        return await setConfigValue(args);
      } catch (error) {
        capture('server_request_error', { message: `Error in set_config_value handler: ${error}` });
        return errorResult('Error: Failed to set configuration value');
      }

    case 'get_usage_stats':
      try {
        return await getUsageStats();
      } catch (error) {
        capture('server_request_error', { message: `Error in get_usage_stats handler: ${error}` });
        return errorResult('Error: Failed to get usage statistics');
      }

    case 'get_prompts':
      try {
        const result = await getPrompts((args ?? {}) as any);

        if (args && typeof args === 'object' && !result.isError) {
          const action = (args as any).action;
          try {
            if (action === 'get_prompt' && (args as any).promptId) {
              const { loadPromptsData } = await import('./tools/prompts.js');
              const promptsData = await loadPromptsData();
              const prompt = promptsData.prompts.find((p) => p.id === (args as any).promptId);
              if (prompt) {
                await capture('server_get_prompt', {
                  prompt_id: prompt.id,
                  prompt_title: prompt.title,
                  category: prompt.categories[0] || 'uncategorized',
                  author: prompt.author,
                  verified: prompt.verified,
                });
              }
            }
          } catch {
            // Analytics must never fail the request.
          }
        }

        const onboardingState = await usageTracker.getOnboardingState();
        if (onboardingState.attemptsShown > 0 && !onboardingState.promptsUsed) {
          await usageTracker.markOnboardingPromptsUsed();
        }

        return result;
      } catch (error) {
        capture('server_request_error', { message: `Error in get_prompts handler: ${error}` });
        return errorResult('Error: Failed to retrieve prompts');
      }

    case 'get_recent_tool_calls':
      try {
        return await handlers.handleGetRecentToolCalls(args);
      } catch (error) {
        capture('server_request_error', { message: `Error in get_recent_tool_calls handler: ${error}` });
        return errorResult('Error: Failed to get tool call history');
      }

    case 'track_ui_event':
      try {
        return await handlers.handleTrackUiEvent(args);
      } catch (error) {
        capture('server_request_error', { message: `Error in track_ui_event handler: ${error}` });
        return errorResult('Error: Failed to track UI event');
      }

    case 'give_feedback_to_desktop_commander':
      try {
        return await giveFeedbackToDesktopCommander(args as any);
      } catch (error) {
        capture('server_request_error', { message: `Error in give_feedback_to_desktop_commander handler: ${error}` });
        return errorResult('Error: Failed to open feedback form');
      }

    case 'start_process':
      return handlers.handleStartProcess(args);
    case 'read_process_output':
      return handlers.handleReadProcessOutput(args);
    case 'interact_with_process':
      return handlers.handleInteractWithProcess(args);
    case 'force_terminate':
      return handlers.handleForceTerminate(args);
    case 'list_sessions':
      return handlers.handleListSessions();
    case 'list_processes':
      return handlers.handleListProcesses();
    case 'kill_process':
      return handlers.handleKillProcess(args);
    case 'read_file':
      return handlers.handleReadFile(args);
    case 'read_multiple_files':
      return handlers.handleReadMultipleFiles(args);
    case 'write_file':
      return handlers.handleWriteFile(args);
    case 'write_pdf':
      return handlers.handleWritePdf(args);
    case 'create_directory':
      return handlers.handleCreateDirectory(args);
    case 'list_directory':
      return handlers.handleListDirectory(args);
    case 'move_file':
      return handlers.handleMoveFile(args);
    case 'start_search':
      return handlers.handleStartSearch(args);
    case 'get_more_search_results':
      return handlers.handleGetMoreSearchResults(args);
    case 'stop_search':
      return handlers.handleStopSearch(args);
    case 'list_searches':
      return handlers.handleListSearches();
    case 'get_file_info':
      return handlers.handleGetFileInfo(args);
    case 'edit_block':
      return handlers.handleEditBlock(args);

    default:
      capture('server_unknown_tool', { name });
      return errorResult(`Error: Unknown tool: ${name}`);
  }
}

export async function executeStockToolCall(
  request: StockToolExecutionRequest,
): Promise<ServerResult> {
  const { name, arguments: args } = request;
  const startTime = Date.now();
  let telemetryData: any = { tool_name: name };
  let result: ServerResult;
  let isError = false;

  try {
    const isRemoteCall = getCurrentCallIsRemote();
    if (isRemoteCall) {
      telemetryData.remote = String((request.metadata as any)?.remote ?? true);
      const remoteClient =
        getCurrentRemoteClient() ?? { name: 'remote-unknown', version: 'unknown' };
      telemetryData.client_name = remoteClient.name;
      telemetryData.client_version = remoteClient.version;
    }

    if (
      name === 'set_config_value'
      && args
      && typeof args === 'object'
      && 'key' in args
    ) {
      telemetryData.set_config_value_key_name = (args as any).key;
    }

    if (name === 'get_prompts' && args && typeof args === 'object') {
      const promptArgs = args as any;
      telemetryData.action = promptArgs.action;
      if (promptArgs.category) {
        telemetryData.category = promptArgs.category;
        telemetryData.has_category_filter = true;
      }
      if (promptArgs.promptId) {
        telemetryData.prompt_id = promptArgs.promptId;
      }
    }

    trackToolCall(name, args);
    result = await dispatchTool(name, args);

    const duration = Date.now() - startTime;
    isError = !!result.isError;

    const excludedFromHistory = ['get_recent_tool_calls', 'track_ui_event'];
    if (!excludedFromHistory.includes(name)) {
      toolHistory.addCall(name, args, result, duration);
    }

    if (name === 'track_ui_event') {
      return result;
    }

    if (result.isError) {
      await usageTracker.trackFailure(name);
    } else {
      await usageTracker.trackSuccess(name);

      const shouldShowOnboarding = await usageTracker.shouldShowOnboarding();
      if (shouldShowOnboarding) {
        const onboardingResult = await usageTracker.getOnboardingMessage();
        const stats = await usageTracker.getStats();
        await capture('server_onboarding_shown', {
          trigger_tool: name,
          total_calls: stats.totalToolCalls,
          successful_calls: stats.successfulCalls,
          days_since_first_use: Math.floor(
            (Date.now() - stats.firstUsed) / (1000 * 60 * 60 * 24),
          ),
          total_sessions: stats.totalSessions,
          message_variant: onboardingResult.variant,
        });

        if (
          result.content
          && result.content.length > 0
          && result.content[0].type === 'text'
        ) {
          const currentContent = result.content[0].text || '';
          result.content[0].text = `${currentContent}${onboardingResult.message}`;
        } else {
          result.content = [
            ...(result.content || []),
            { type: 'text', text: onboardingResult.message },
          ];
        }

        await usageTracker.markOnboardingShown(onboardingResult.variant);
      }

      const shouldPrompt = await usageTracker.shouldPromptForFeedback();
      if (shouldPrompt) {
        const feedbackResult = await usageTracker.getFeedbackPromptMessage();
        const stats = await usageTracker.getStats();
        await capture('feedback_prompt_injected', {
          trigger_tool: name,
          total_calls: stats.totalToolCalls,
          successful_calls: stats.successfulCalls,
          failed_calls: stats.failedCalls,
          days_since_first_use: Math.floor(
            (Date.now() - stats.firstUsed) / (1000 * 60 * 60 * 24),
          ),
          total_sessions: stats.totalSessions,
          message_variant: feedbackResult.variant,
        });

        if (
          result.content
          && result.content.length > 0
          && result.content[0].type === 'text'
        ) {
          const currentContent = result.content[0].text || '';
          result.content[0].text = `${currentContent}${feedbackResult.message}`;
        } else {
          result.content = [
            ...(result.content || []),
            { type: 'text', text: feedbackResult.message },
          ];
        }

        await usageTracker.markFeedbackPrompted();
      }

      result = await processDockerPrompt(result, name);
    }

    try {
      const argSchema = toolArgSchemas[name];
      if (argSchema && result && Array.isArray((result as any).content)) {
        const unsupported = detectUnsupportedParams(args, argSchema);
        if (unsupported.length > 0) {
          const warning = buildUnsupportedParamsWarning(
            name,
            unsupported,
            getSupportedParams(argSchema),
          );
          (result as any).content = [
            { type: 'text', text: warning },
            ...(result as any).content,
          ];
        }
      }
    } catch {
      // Advisory warnings must not break a successful call.
    }

    return result;
  } catch (error) {
    isError = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await usageTracker.trackFailure(name);
    capture('server_request_error', { error: errorMessage });
    return errorResult(`Error: ${errorMessage}`);
  } finally {
    if (name !== 'track_ui_event') {
      capture_call_tool('server_call_tool', {
        ...telemetryData,
        duration_ms: Date.now() - startTime,
        is_error: String(isError),
      });
    }
  }
}
