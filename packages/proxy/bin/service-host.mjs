import { verifyRelease } from "./release-files.mjs";
import { Updates } from "./updates.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { linuxService } from "./linux-service.mjs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
const execute = promisify(execFile);

export function serviceController({ root, launcher, dataDir, instance }) {
  const updates=new Updates({root,dataDir,version:instance.version});
  async function windows(action) {
    if (process.platform !== "win32") throw new Error("Sign-in startup controls currently require Windows.");
    const result = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "windows/Service.ps1"), "-Action", action, "-Launcher", launcher, "-NodePath", process.execPath, "-DataDir", dataDir], { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
    return result.stdout;
  }
  return {
    async status() {
      if(process.platform === "linux")return linuxService({dataDir,launcher}).status();
      if (process.platform !== "win32") return { supported: false, installed: false, enabled: false };
      return JSON.parse(await windows("inspect"));
    },
    async startup(enabled) { if(process.platform === "linux")await linuxService({dataDir,launcher}).command(enabled?"install":"disable");else await windows(enabled ? "install" : "disable"); },
    async update(action,version){return updates.command(action,version)},
    async prepareUpdate(action){updates.prepare(action)},
    async restart(action) {
      if(process.platform === "linux" && !action){
        const service=linuxService({dataDir,launcher}),current=await service.status();
        if(current.installed&&current.pid===instance.pid){
          await execute('systemctl',['--user','--no-block','restart',service.unit],{timeout:10000,maxBuffer:65536});
          return;
        }
      }
      let updateFile;
      if(action){const next=updates.prepare(action),old={...verifyRelease(root),source:"local"};updateFile=join(updates.folder,"handoff-"+randomUUID()+".json");writeFileSync(updateFile,JSON.stringify({old,next,pid:instance.pid,nonce:instance.nonce,data:dataDir,startup:await this.status()}),{mode:0o600})}
      const helper = spawn(process.execPath, (updateFile?[join(dirname(launcher),"update-handoff.mjs"),updateFile]:[join(dirname(launcher), "restart.mjs"), String(instance.pid), instance.nonce, launcher]), { detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, M365_DATA_DIR: dataDir } });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { helper.kill(); reject(new Error("Restart helper did not become ready")); }, 5000);
        helper.once("error", error => { clearTimeout(timeout); reject(error); });
        helper.once("exit", () => { clearTimeout(timeout); reject(new Error("Restart helper exited before ready")); });
        helper.once("message", message => { if (message !== "ready") return; clearTimeout(timeout); helper.disconnect(); helper.unref(); resolve(); });
      });
      // The HTTP response has already completed; Nitro closes and flushes history normally.
      process.emit("SIGTERM");
    },
  };
}
