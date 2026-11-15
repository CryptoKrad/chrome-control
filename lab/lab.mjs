// lab helper: node lab.mjs <pid> state | call <tool> <json>
import { execFileSync } from "node:child_process";
export const cua = (tool, args) => { try { return JSON.parse(execFileSync("cua-driver", ["call", tool, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); } catch (e) { return { error: String(e.stdout || e.stderr || e.message).slice(0, 600) }; } };
export const front = () => execFileSync("lsappinfo", ["info", "-only", "pid,name", execFileSync("lsappinfo", ["front"], { encoding: "utf8" }).trim()], { encoding: "utf8" }).replace(/"(pid|LSDisplayName)"=/g, "").replace(/\s+/g, " ").trim();
export const zorder = () => (cua("get_accessibility_tree", {}).windows ?? []).slice(0, 6).map((w) => `${w.pid}:${w.window_id}:${(w.title ?? "").slice(0, 14)}`).join(" > ");
export function state(pid) {
  const ws = (cua("list_windows", { pid }).windows ?? []).filter((w) => w.title);
  return ws.map((w) => {
    const s = cua("get_window_state", { pid, window_id: w.window_id, include_screenshot: false, max_elements: 400 });
    const tree = s.tree_markdown ?? "", pick = (re) => re.exec(tree)?.[1];
    return { window_id: w.window_id, win: w.title, onscreen: w.is_on_screen, timer: pick(/"(timer \d+)"/), raf: pick(/"(raf \d+)"/), view: pick(/"(view \w+)"/), log: pick(/"(events [^"]*)"/), sub: pick(/"(submitted [^"]*)"/), snapshot_id: s.snapshot_id, tree };
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [pid, cmd, tool, json] = process.argv.slice(2);
  if (cmd === "state") for (const { tree, ...s } of state(Number(pid))) console.log(JSON.stringify(s));
  if (cmd === "call") console.log(JSON.stringify(cua(tool, JSON.parse(json)), null, 1).slice(0, 3000));
  console.log("front:", front());
}
