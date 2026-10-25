import { EventEmitter } from "node:events";
let made = 0;
export default class OfflineWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  closed = false;
  constructor() {
    super();
    this.number = ++made;
    queueMicrotask(() => {
      if (this.closed) return;
      if (process.env.M365_TEST_CHAT_MODE === "reconnect" && this.number === 1) this.emit("error", new Error("offline handshake failure"));
      else { this.readyState = 1; this.emit("open"); }
    });
  }
  close() { if (!this.closed) { this.closed = true; this.readyState = 3; queueMicrotask(() => this.emit("close")); } }
  terminate() { this.close(); }
  send(text) {
    for (const part of text.split("\x1e").filter(Boolean)) {
      const frame = JSON.parse(part);
      if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
      if (frame.target !== "chat" || frame.type !== 4) continue;
      if (process.env.M365_TEST_CHAT_MODE === "hold") continue;
      setTimeout(() => {
        if (this.closed) return;
        if (process.env.M365_TEST_CHAT_MODE === "throttled") {
          this.emit("message", Buffer.from(JSON.stringify({ type: 2, item: { result: { value: "Throttled", errorCode: "PerUserThrottled" }, messages: [] } }) + "\x1e"));
          return;
        }
        this.emit("message", Buffer.from(JSON.stringify({ type: 1, target: "update", arguments: [{ messages: [{ author: "bot", messageId: "offline-" + this.number, text: "Offline fixture reply. ✓", contentOrigin: "Claude" }] }] }) + "\x1e"));
        this.emit("message", Buffer.from(JSON.stringify({ type: 2, item: { result: { value: "Success" }, messages: [], turnState: "Completed", throttling: { numUserMessagesInConversation: 1, maxNumUserMessagesInConversation: 600 } } }) + "\x1e"));
      }, 20);
    }
  }
}
