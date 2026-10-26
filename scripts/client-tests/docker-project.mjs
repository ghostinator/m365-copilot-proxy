import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative, isAbsolute, sep } from "node:path";

export function dockerProject(cwd) {
  const desktop = join(homedir(), "AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe");
  const docker = process.env.CLIENT_TEST_DOCKER || (existsSync(desktop) ? desktop : "docker");
  // Only Docker's credential helper needs the host environment; no client receives it.
  const env = { PATH: `${dirname(docker)}${delimiter}${process.env.PATH}`, SystemRoot: process.env.SystemRoot,
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const run = args => execFileSync(docker, args, { env, windowsHide: true, encoding: "utf8", timeout: 30_000 });
  const name = `m365-client-pack-${randomUUID()}`;
  let id;
  try { id = run(["run", "--name", name, "--detach", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=128m", "--cpus=1", "--user=65534:65534",
    "--tmpfs=/task:rw,nosuid,nodev,size=16m,mode=1777", "--tmpfs=/tmp:rw,nosuid,nodev,size=16m,mode=1777",
    "--workdir=/task", process.env.CLIENT_TEST_IMAGE || "python:3-slim", "sleep", "1800"]).trim();
  } catch (error) {
    try { run(["rm", "--force", name]); } catch { /* Startup may fail before creating the named container. */ }
    throw error;
  }
  const path = absolute => {
    const rel = relative(cwd, absolute);
    assert.ok(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`), "Tool path leaves fixture project");
    return `/task/${rel.split(sep).join("/")}`;
  };
  const python = (code, ...args) => run(["exec", id, "python", "-c", code, ...args]);
  const read = p => Buffer.from(python("import base64,pathlib,sys; print(base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode())", p).trim(), "base64");
  const write = (p, content) => python("import base64,pathlib,sys; p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(base64.b64decode(sys.argv[2]))", p, Buffer.from(content).toString("base64"));
  let shellCalls = 0;
  return {
    id, read, write, path,
    files() { return JSON.parse(python("import json,pathlib; root=pathlib.Path('/task'); print(json.dumps(sorted(str(p.relative_to(root)) for p in root.rglob('*') if p.is_file())))")); },
    get shellCalls() { return shellCalls; },
    operations: {
      async readFile(p) { return read(path(p)); },
      async writeFile(p, content) { write(path(p), content); },
      async access(p) { python("import pathlib,sys; assert pathlib.Path(sys.argv[1]).is_file()", path(p)); },
      async mkdir(p) { python("import pathlib,sys; pathlib.Path(sys.argv[1]).mkdir(parents=True,exist_ok=True)", path(p)); },
      async detectImageMimeType() { return null; },
    },
    bash: { exec(command, _cwd, options) {
      shellCalls++;
      return new Promise((resolve, reject) => {
        const child = spawn(docker, ["exec", id, "timeout", "15", "sh", "-c", command], { env, windowsHide: true });
        child.stdout.on("data", options.onData); child.stderr.on("data", options.onData);
        const abort = () => { run(["kill", id]); child.kill(); };
        options.signal?.addEventListener("abort", abort, { once: true });
        child.once("error", reject);
        child.once("close", exitCode => { options.signal?.removeEventListener("abort", abort); resolve({ exitCode }); });
      });
    } },
    verifyIsolation() {
      const details = JSON.parse(run(["inspect", id]))[0];
      assert.equal(details.HostConfig.NetworkMode, "none");
      assert.equal(details.HostConfig.ReadonlyRootfs, true);
      assert.equal(details.Mounts.length, 0, "No host files may be mounted");
    },
    close() { run(["rm", "--force", id]); },
  };
}
