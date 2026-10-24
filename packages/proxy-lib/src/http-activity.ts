type Kind = "models" | "chat" | "health" | "other";
interface Event { method: string; endpoint: string; receivedAt: string; status: number | null; durationMs: number | null }
const ignored = new Set(["/dashboard", "/dashboard-script", "/v1/proxy/status", "/favicon.ico"]);
const endpoints: Record<string, Kind> = { "/v1/models": "models", "/v1/chat/completions": "chat", "/health": "health", "/health/live": "health", "/health/ready": "health", "/v1/responses": "other", "/v1/messages": "other", "/messages": "other" };

/** Bounded, credential-free HTTP metadata; includes rejected/invalid requests. */
export class HttpActivity {
  private total = 0;
  private completed = 0;
  private failed = 0;
  private categories = { models: 0, chat: 0, health: 0, other: 0 };
  private recent: Event[] = [];

  begin(method: string, pathname: string): ((status: number) => void) | null {
    if (ignored.has(pathname)) return null;
    const started = Date.now();
    const known = Object.hasOwn(endpoints, pathname);
    const kind = known ? endpoints[pathname] : "other";
    const event: Event = { method: /^(GET|POST|HEAD|OPTIONS|PUT|PATCH|DELETE)$/.test(method) ? method : "OTHER", endpoint: known ? pathname : "(other endpoint)", receivedAt: new Date(started).toISOString(), status: null, durationMs: null };
    this.total++;
    this.categories[kind]++;
    this.recent.push(event);
    if (this.recent.length > 20) this.recent.shift();
    let finished = false;
    return status => {
      if (finished) return;
      finished = true;
      event.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
      event.durationMs = Math.max(0, Date.now() - started);
      this.completed++;
      if (event.status >= 400) this.failed++;
    };
  }

  snapshot() {
    return { total: this.total, active: this.total - this.completed, completed: this.completed, failed: this.failed, categories: { ...this.categories }, recent: this.recent.map(event => ({ ...event })).reverse() };
  }
}

export const httpActivity = new HttpActivity();

/** Keep streamed requests active until EOF/cancel without consuming them early. */
export function trackHttpResponse(response: Response, finish: ((status: number) => void) | null): Response {
  if (!finish) return response;
  if (!response.body) { finish(response.status); return response; }
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { finish(response.status); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { finish(502); controller.error(error); }
    },
    async cancel(reason) { finish(499); await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
