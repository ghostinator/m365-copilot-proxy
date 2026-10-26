import { ChatCompletionRequest } from './schemas.js';
import { SessionPool, handleChatCompletion } from './handler.js';
import { clientProfiles } from './client-profiles.js';
import { callerIdentity, readJsonBody } from './http-policy.js';
import { type RequestTrace } from './http-activity.js';
import { parseResponsesRequest } from './responses-adapter.js';
import { parseMessagesRequest } from './messages-adapter.js';
import { ClientRequestError, clientErrorResponse } from './client-adapter-types.js';

export const COMPLETION_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];

export async function clientErrorForRequest(request: Request, response: Response): Promise<Response> {
  if (new URL(request.url).pathname !== '/v1/messages' || response.status < 400) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length'); headers.delete('content-encoding');
  let value: unknown;
  try { value = await response.json(); } catch { value = { message: 'Request failed' }; }
  return clientErrorResponse(value, 'messages', response.status, headers);
}

/** Share profiles, request limits, admission and session identity across protocols. */
export async function handleCompletionRequest(request: Request, pool: SessionPool, activity?: RequestTrace): Promise<Response> {
  const path = new URL(request.url).pathname;
  let parsed;
  try {
    const value = clientProfiles.apply(await readJsonBody(request.body, request.headers.get('content-length'), request.signal), request.headers);
    parsed = path === '/v1/responses' ? parseResponsesRequest(value)
      : path === '/v1/messages' ? parseMessagesRequest(value)
      : { body: ChatCompletionRequest.parse(value), adapt: async (response: Response) => response };
  } catch (error) {
    const message = error instanceof ClientRequestError ? error.message
      : error instanceof Error && /size limit|deadline|aborted/i.test(error.message) ? error.message
      : 'Malformed JSON or invalid request body';
    activity?.diagnostic('invalid_request_error', message);
    return clientErrorForRequest(request, Response.json({ error: { type: 'invalid_request_error', message } }, {
      status: /size limit/.test(message) ? 413 : 400, headers: { Connection: 'close' },
    }));
  }
  return parsed.adapt(await handleChatCompletion(parsed.body, pool, {
    activity, signal: request.signal, conversationId: request.headers.get('x-conversation-id') ?? undefined,
    callerId: callerIdentity(request.headers),
  }));
}
