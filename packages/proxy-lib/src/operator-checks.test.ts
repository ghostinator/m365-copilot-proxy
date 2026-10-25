import { expect, it } from "vitest";
import { parseWindowsListeners, parseLinuxListeners } from "./operator-checks.js";
it("distinguishes separate loopback/Tailnet processes without exposing process arguments", () => {
  const listeners = parseWindowsListeners(JSON.stringify([{ LocalAddress: "127.0.0.1", LocalPort: 4141, OwningProcess: 10 }, { LocalAddress: "100.64.0.2", LocalPort: 4141, OwningProcess: 20, CommandLine: "private arguments" }]), 10);
  expect(listeners).toEqual([{ host: "127.0.0.1", port: 4141, pid: 10, thisInstance: true }, { host: "100.64.0.2", port: 4141, pid: 20, thisInstance: false }]);
});
it("parses Linux listener identity while leaving unavailable process ownership unknown", () => {
  expect(parseLinuxListeners('LISTEN 0 511 127.0.0.1:4141 0.0.0.0:* users:(("node",pid=10,fd=20))\nLISTEN 0 511 [::]:4141 [::]:*', 10)).toEqual([{ host: "127.0.0.1", port: 4141, pid: 10, thisInstance: true }, { host: "::", port: 4141, pid: null, thisInstance: false }]);
});
