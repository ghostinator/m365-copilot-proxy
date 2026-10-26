import { z } from 'zod/v4';
import { ChatCompletionRequest } from './schemas.js';

export type ClientAdapterRequest = { body: z.output<typeof ChatCompletionRequest>; adapt: (response: Response) => Promise<Response> };
export type Wire = Record<string, any>;
export class ClientRequestError extends Error { readonly status = 400; readonly statusCode = 400; readonly code = 'invalid_request_error'; }
export function invalid(message: string): never { throw new ClientRequestError(message); }
export function object(value: unknown, context: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${context} must be an object`);
  return value as Wire;
}
export function string(value: unknown, context: string): string {
  if (typeof value !== 'string') invalid(`${context} must be a string`);
  return value;
}
export function list(value: unknown, context: string): any[] { if (!Array.isArray(value)) invalid(`${context} must be an array`); return value; }
export function rejectFields(value: Wire, fields: string[]): void { for (const key of fields) if (value[key] != null && value[key] !== false) invalid(`${key} is not supported; send full text/tool history`); }
export function ignoredControls(value: Wire): string[] {
  const controls=['temperature','top_p','top_k','max_tokens','max_output_tokens','stop_sequences','reasoning','thinking','service_tier','parallel_tool_calls','truncation','seed','presence_penalty','frequency_penalty'].filter(key => value[key] !== undefined);
  if(value.text?.verbosity!==undefined)controls.push('text.verbosity');
  if(value.output_config?.effort!==undefined)controls.push('output_config.effort');
  if(value.tool_choice?.disable_parallel_tool_use!==undefined)controls.push('tool_choice.disable_parallel_tool_use');
  return controls;
}
export function responseHeaders(source: Response, ignored: string[], stream = false): Headers {
  const headers = new Headers(source.headers);
  headers.delete('content-length'); headers.delete('content-encoding');
  headers.set('content-type', stream ? 'text/event-stream; charset=utf-8' : 'application/json');
  if (ignored.length) headers.set('x-m365-ignored-controls', ignored.join(', '));
  return headers;
}
export function clientErrorResponse(value: unknown, protocol: 'responses' | 'messages', status = 400, headers?: HeadersInit): Response {
  const outer = value instanceof Error ? {message:value.message} : object(value,'error');
  const error = outer.error ?? outer;
  const type = status === 401 ? 'authentication_error' : status === 403 ? 'permission_error' : status === 404 ? 'not_found_error' : status === 413 ? 'request_too_large' : status === 429 ? 'rate_limit_error' : status === 529 ? 'overloaded_error' : status >= 500 ? 'api_error' : 'invalid_request_error';
  const body = protocol === 'messages' ? {type:'error',error:{type,message:error.message ?? 'Request failed',...(error.code!==undefined?{code:error.code}:{}),...(error.details!==undefined?{details:error.details}:{})}} : {error:{...error,type:error.type ?? type,message:error.message ?? 'Request failed'}};
  const resultHeaders=new Headers(headers);resultHeaders.set('content-type','application/json');
  return Response.json(body,{status,headers:resultHeaders});
}
export function validateHistory(messages: Wire[]): void {
  const pending = new Set<string>(); const seen = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.tool_call_id)) invalid('Tool result has an unmatched or duplicate call ID');
    } else {
      if (pending.size) invalid('Tool calls must have results before the next message');
      for (const call of message.tool_calls ?? []) {
        if (!call.id || seen.has(call.id)) invalid('Tool call IDs must be nonempty and unique');
        seen.add(call.id); pending.add(call.id);
      }
    }
  }
  if (pending.size) invalid('Every historical tool call must have a result');
}
