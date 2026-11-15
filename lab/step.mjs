// step.mjs <pid> <steps…>   steps: press|<window title starts>|<role>|<label>   set|…|<label>|<text>   type|…|<label>|<text>   key|…|<label or ->|<key>   frame|…|x,y,w,h   wait|<s>   show
import { cua, state, front, zorder } from "./lab.mjs";
import { execFileSync } from "node:child_process";
const [pid, ...steps] = process.argv.slice(2);
const P = Number(pid), sleep = (s) => execFileSync("sleep", [String(s)]);
const idx = (s, role, label) => { const m = new RegExp(`\\[(\\d+)\\] ${role} "${label}"`).exec(s.tree); return m ? Number(m[1]) : null; };
const brief = (r) => JSON.stringify(r.error ? { error: r.error.replace(/\s+/g, " ").slice(0, 220) } : { effect: r.effect, mode: r.delivery?.mode, route: r.route, code: r.code });
const show = () => { for (const s of state(P)) console.log(`   [${s.window_id}] title: ${s.win.slice(0, 96)} | tree: ${[s.timer, s.view, s.sub].join(" · ")} | web: ${/AXWebArea "([^"]*)"/.exec(s.tree)?.[1]?.slice(0, 30)}`); console.log(`   front ${front()} | z ${zorder()}`); };
show();
for (const step of steps) {
  const [op, win, a, b] = step.split("|");
  if (op === "wait") { sleep(Number(win)); console.log(`wait ${win}`); show(); continue; }
  if (op === "show") { show(); continue; }
  const s = state(P).find((x) => (/^\d+$/.test(win) ? x.window_id === Number(win) : x.win.startsWith(win)));
  if (!s) { console.log(`${step} -> no window titled ${win}…`); continue; }
  const at = { pid: P, window_id: s.window_id, snapshot_id: s.snapshot_id };
  let r;
  if (op === "press") r = cua("click", { ...at, element_index: idx(s, a, b), action: "press" });
  if (op === "set") r = cua("set_value", { ...at, element_index: idx(s, "AXTextField", a), value: b });
  if (op === "type") r = cua("type_text", { ...at, element_index: idx(s, "AXTextField", a), text: b });
  if (op === "key") r = cua("press_key", { ...at, ...(a !== "-" ? { element_index: idx(s, "AXTextField", a) } : {}), key: b });
  if (op === "frame") { const [x, y, width, height] = a.split(",").map(Number); r = cua("set_window_frame", { pid: P, window_id: s.window_id, x, y, width, height }); }
  console.log(`${step} -> ${brief(r)}`); sleep(3); show();
}
