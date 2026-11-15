// lab/e2e.mjs — the tool end to end, in a Chrome of its own on a temp profile, behind whatever app is in front.
// Needs macOS, Google Chrome, cua-driver with its permissions and python3. Run: node lab/e2e.mjs
// It serves lab/site on 127.0.0.1:8799, starts the browser with `launch`, runs every acting command against the lab
// page, checks that the front app never changed, then closes the browser and deletes the profile.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tool = new URL("../chrome-control.mjs", import.meta.url).pathname, site = new URL("./site/", import.meta.url).pathname;
const home = mkdtempSync(path.join(tmpdir(), "chrome-control-e2e-")), URL_ = "http://127.0.0.1:8799/";
const env = { ...process.env, CHROME_CONTROL_HOME: home, CHROME_CONTROL_BROWSER: "e2e" };
const cc = (...args) => { try { return { code: 0, out: execFileSync("node", [tool, ...args], { cwd: home, env, encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
const front = () => execFileSync("lsappinfo", ["info", "-only", "pid,name", execFileSync("lsappinfo", ["front"], { encoding: "utf8" }).trim()], { encoding: "utf8" }).replace(/"\w+"=/g, "").replace(/\s+/g, " ").trim();
const sleep = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);
const step = (name, r, code, text) => { assert.equal(r.code, code, `${name}: exit ${r.code}\n${r.out}`); if (text) assert.ok(r.out.includes(text), `${name}: no ${text} in\n${r.out}`); console.log(`ok  ${name}`); };

const server = spawn("python3", ["-m", "http.server", "8799", "--bind", "127.0.0.1"], { cwd: site, stdio: "ignore" });
const before = front();
let pid = 0;
try {
  sleep(1);
  const started = cc("launch", "e2e", URL_);
  pid = Number(/pid (\d+)/.exec(started.out)?.[1]);
  step("launch stays behind the front app", started, 0, "started in the background");
  sleep(4);
  step("read prints short lines", cc("read"), 0, 'button "Sync view"');
  step("find", cc("find", "sync view"), 0, 'button "Sync view"');
  step("press prints what changed", cc("press", "Sync view", "button"), 0, '"view sync"');
  step("fill fires input and change", cc("fill", "Plain field", "hello"), 0, '"events input,change value=hello"');
  step("type sends real keys", cc("type", "Search box", "query one"), 0, 'textfield "Search box" = "query one"');
  step("key return submits the form", cc("key", "return", "Search box"), 0, '"submitted query one"');
  step("wait sees the text", cc("wait", "submitted query one", "6"), 0, '"submitted query one"');
  step("wait times out with exit 4", cc("wait", "no such text", "2"), 4);
  step("a secret field is refused with exit 2", cc("fill", "Password", "x"), 2);
  step("open in the background", cc("open", `${URL_}two.html`), 0, 'heading "Lab two"');
  step("a link press prints the new page", cc("press", "Back", "link"), 0, 'heading "Lab one"');
  step("open again, now that the address bar has history to offer", cc("open", `${URL_}two.html`), 0, "opened in the background");
  step("the toolbar is read apart", cc("read", "--ui"), 0, 'textfield "Address and search bar"');
  const id = cc("windows").out.split(" ")[0];
  step("session a keeps the window", cc("use", id, "--session", "a"), 0, "kept window");
  step("session b is refused it", cc("use", id, "--session", "b"), 1, "kept by session a");
  step("session a lets go", cc("release", "--session", "a"), 0, "released");
  step("doctor", cc("doctor"), 0, "keys: `type`, `key` and a background `open` work");
  assert.equal(front(), before, "the front app changed during the run (if you switched apps yourself, run it again)");
  console.log(`ok  the front app stayed ${before}`);
} finally {
  if (pid) process.kill(pid);
  server.kill();
  sleep(2);
  rmSync(home, { recursive: true, force: true });
}
