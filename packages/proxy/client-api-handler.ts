import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCompletionRequest, incomingRequestBody, type RequestTrace } from '@m365-copilot/proxy-lib';
import { pool } from './server-pool';

export function handleClientApiEvent(req: IncomingMessage, res: ServerResponse, activity?: RequestTrace): Promise<Response> {
  const controller = new AbortController();
  let finished = false;
  res.once('finish', () => { finished = true; });
  const abort = () => { if (!finished && !res.writableEnded) controller.abort(); };
  req.once('aborted', abort); res.once('close', abort);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
    else if (value !== undefined) headers.set(name, value);
  }
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST', headers, body: incomingRequestBody(req), signal: controller.signal, duplex: 'half',
  };
  return handleCompletionRequest(new Request(new URL(req.url ?? '/', 'http://proxy.local'), init), pool, activity);
}
