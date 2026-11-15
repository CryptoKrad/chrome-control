// launch.mjs <name> [chrome flags…]: a lab Chrome on an empty temp profile, started in the background by cua-driver. Prints its pid.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const [name, ...flags] = process.argv.slice(2);
const dir = mkdtempSync(path.join(tmpdir(), `cc-lab-${name}.`));
const r = JSON.parse(execFileSync("cua-driver", ["call", "launch_app", JSON.stringify({ bundle_id: "com.google.Chrome", creates_new_application_instance: true, additional_arguments: [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-popup-blocking", ...flags, "http://127.0.0.1:8765/"] })], { encoding: "utf8" }));
writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify({ pid: r.pid, dir }) + "\n");
console.log(name, r.pid, dir);
