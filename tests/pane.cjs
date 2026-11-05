const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const dir = path.resolve(__dirname, "../config/mods/tinkery-pane");

function element() {
  const node = { items: [], handlers: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "on_click") node.handlers.click = args[0];
      else if (key === "on_mouse_down") node.handlers[args[0]] = args[1];
      else if (key === "id") node.key = args[0];
      return proxy;
    };
  } });
  return proxy;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items) { const found = find(child, id); if (found) return found; }
  return null;
}

function texts(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const child of node.items) texts(child, out);
  return out;
}

const calls = [], overlays = [], notices = [], commandListeners = new Set();
let stopped = 0;
const program = { name: "Pi", key: "pi", agent: true };
const pane = { pane: "p2", terminal: "t2", tab: "b", title: "pi", cwd: "/fixture-home/project", program, status: "working" };
const shell = { pane: "p3", terminal: "t3", tab: "b", title: "me@mac: ~/project", cwd: "/fixture-home/project", program: { name: "zsh", key: "shell", shell: true }, status: null };
let terms = [{ address: "t2", state: "live", labels: {} }, { address: "t3", state: "live", labels: {} }];
let tab = { id: "b", name: "Release", named: true };
let sidebar = { id: "root", children: [{ id: "sidebar-lists", active: "lists" }] };
let props = { pane: "p2" };
let focus = null, agentList = [];
let availableCommands = [];
const env = {
  View: class {}, div: element, svg: element, image: element, h_flex: element,
  theme: () => ({}), props: () => props, panes: () => [pane, shell], home: () => "/fixture-home",
  terminals: () => terms, agents: () => agentList, focused: () => focus, spaces: () => [{ tabs: [tab] }], layout: () => sidebar,
  commands: () => availableCommands,
  nextCommand: () => new Promise((resolve) => commandListeners.add(resolve)),
  notify: (notice) => notices.push(notice.title),
  run: (name, args) => calls.push([name, args]),
  openOverlay: (spec) => { overlays.push(JSON.parse(JSON.stringify(spec))); return "overlay"; },
};
const cx = { notify() {}, stop_propagation() { stopped++; }, spawn(task) { task(cx); } };
// name.js and tree.js are inlined as the mod's own copies are.
function load(copyProps = () => props) {
  const files = ["name.js", "tree.js", "main.js"].map((name) => path.join(dir, name));
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/export (function|const) /g, "$1 ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext({ ...env, props: copyProps });
  vm.runInContext(src, context, { filename: files.at(-1) });
  const mod = new context.Mod(); mod.init({}, cx); return mod;
}
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));
const header = load();
header.hovered = true;
find(header.render(), "pane-head-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.focus", { pane: "p2" }]]);
find(header.render(), "ph-r-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "right", pane: "p2" }]]);
find(header.render(), "ph-d-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "down", pane: "p2" }]]);
find(header.render(), "ph-z-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.zoom", { pane: "p2" }]]);
find(header.render(), "ph-x-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.close", { pane: "p2" }]]);

// Names: Pi session, else (agents only) a named tab, else a telling title, else the program.
// The terminal's address leads, then its name.
assert.equal(texts(header.render())[0], "t2");
const named = () => texts(header.render())[1];
terms[0].labels["pi.session"] = "Fix login";
assert.equal(named(), "Fix login");
delete terms[0].labels["pi.session"];
assert.equal(named(), "Release");
tab.named = false; pane.title = "π - Review PR - project";
assert.equal(named(), "Review PR");
pane.title = "π - project";
assert.equal(named(), "Pi", "Pi's unnamed title is only its folder, which the space already says");
pane.title = "⠋ project";
assert.equal(named(), "Pi", "nor Codex's: its spinner and project");
pane.title = "OC | Review PR";
assert.equal(named(), "OC | Review PR", "an agent's marks come off only its own titles");
pane.program = { name: "OpenCode", key: "opencode", agent: true };
assert.equal(named(), "Review PR");
pane.program = program;
pane.title = "✳ Review PR";
assert.equal(named(), "Review PR");
pane.title = "pi";
assert.equal(named(), "Pi");
tab.named = true; props = { pane: "p3" };
assert.equal(named(), "zsh");
shell.title = "t3";
assert.equal(named(), "zsh");

// A settled agent's done dot goes only while the inbox shows.
props = { pane: "p2" }; pane.status = "done"; header.hovered = false;
const dots = () => header.render().items.length;
const shown = dots();
terms[0].labels.settled = "1:1";
assert.equal(dots(), shown);
sidebar.children[0].active = "inbox";
assert.equal(dots(), shown - 1);


// Tinkery additions: right-click opens the native pane menu; agents offer Tinkery; a Tinkery pane hides.
header.hovered = false;
for (const [paneId, terminal] of [["p2", "t2"], ["p3", "t3"]]) {
  props = { pane: paneId };
  const before = stopped;
  find(header.render(), `pane-head-${paneId}`).handlers.right({}, cx);
  assert.equal(stopped, before + 1, "right-click must not bubble");
  assert.deepEqual(overlays.splice(0), [{ mod: "menu", kind: "popup", at: "pointer", width: 240, props: { tab: "pane", target: { pane: paneId, terminal } } }]);
  assert.deepEqual(take(), [], "opening a menu runs no pane action");
}
header.hovered = true; props = { pane: "p2" };
find(header.render(), "ph-tinkery-p2").handlers.click({}, cx);
assert.deepEqual(overlays.splice(0), [{ mod: "tinkery-companion", kind: "window", key: "tinkery-setup:t2", width: 560, height: 420, props: { terminal: "t2" } }]);
assert.deepEqual(take(), []);
props = { pane: "p3" };
assert.equal(find(header.render(), "ph-tinkery-p3"), null, "a shell pane offers no Tinkery");
assert.equal(find(header.render(), "ph-checkout-p3"), null);
terms[1].labels = { "t3-tinkery.owner": "herdr", "t3-tinkery.agent": "t2" };
find(header.render(), "ph-checkout-p3").handlers.click({}, cx);
assert.deepEqual(overlays.splice(0).map((o) => [o.mod, o.props]), [["tinkery-companion", { terminal: "t2" }]]);
find(header.render(), "ph-x-p3").handlers.click({}, cx);
assert.deepEqual(take(), [["terminal.park", { terminal: "t3" }]], "hiding Tinkery keeps it running");
terms[1].labels = { "t3-tinkery.owner": "someone-else", "t3-tinkery.agent": "t2" };
find(header.render(), "ph-x-p3").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.close", { pane: "p3" }]], "only Herdr-owned Tinkery panes are parked");
terms[1].labels = {};
props = { pane: "missing" };
assert.equal(find(header.render(), "pane-head-p2"), null);

// Herdr sends a mod command to every visible copy. Exercise both headers together.
async function broadcast(command) {
  const listeners = [...commandListeners];
  commandListeners.clear();
  for (const deliver of listeners) deliver(command);
  await new Promise(setImmediate);
}

(async () => {
  props = { pane: "p2" };
  load(() => ({ pane: "p3" }));
  agentList = [{ pane: "p2", address: "t2" }];
  focus = { pane: "p2", terminal: "t2" };
  await broadcast("open-tinkery");
  assert.deepEqual(overlays.splice(0), [{ mod: "tinkery-companion", kind: "window", key: "tinkery-setup:t2", width: 560, height: 420, props: { terminal: "t2" } }]);
  assert.deepEqual(notices, [], "the other header stays silent");
  assert.deepEqual(take(), [], "the shortcut opens setup without starting a terminal");

  // A compatible host gets the existing openOverlay behavior above. With reuse available,
  // both the header and shortcut must send the same agent-specific key, and no other action.
  availableCommands = [{ name: "window.open_or_focus" }];
  const setup = (terminal) => ["window.open_or_focus", { mod: "tinkery-companion", key: `tinkery-setup:${terminal}`, width: 560, height: 420, props: { terminal } }];
  header.hovered = true;
  find(header.render(), "ph-tinkery-p2").handlers.click({}, cx);
  await broadcast("open-tinkery");
  assert.deepEqual(take(), [setup("t2"), setup("t2")]);
  agentList.push({ pane: "p3", address: "t3" });
  focus = { pane: "p3", terminal: "t3" };
  await broadcast("open-tinkery");
  assert.deepEqual(take(), [setup("t3")], "another agent gets its own setup");
  agentList.pop();
  props = { pane: "p3" };
  terms[1].labels = { "t3-tinkery.owner": "herdr", "t3-tinkery.agent": "t2" };
  find(header.render(), "ph-checkout-p3").handlers.click({}, cx);
  assert.deepEqual(take(), [setup("t2")], "Change checkout returns to the owner's setup");
  props = { pane: "p2" }; terms[1].labels = {};
  assert.deepEqual(overlays.splice(0), [], "the native path never replaces an existing setup via openOverlay");

  focus = { pane: "p3", terminal: "t3" };
  await broadcast("open-tinkery");
  assert.deepEqual(notices.splice(0), ["Focus an agent pane to open Tinkery."], "one hint for the focused shell");
  focus = { pane: "p2", terminal: "t2", shown: "t3" };
  await broadcast("open-tinkery");
  assert.equal(notices.splice(0).length, 1, "never use the hidden agent behind a displayed shell");
  focus = { pane: "p2", terminal: "t2" };
  terms[0].labels = { "t3-tinkery.owner": "herdr", "t3-tinkery.agent": "other-agent" };
  await broadcast("open-tinkery");
  assert.equal(notices.splice(0).length, 1, "a companion is never its own agent");
  focus = null;
  await broadcast("open-tinkery");
  assert.deepEqual(notices, [], "no header claims missing focus");
  assert.deepEqual(overlays, [], "ineligible panes never open setup");
  assert.deepEqual(take(), []);
  console.log("ok: pane controls, naming, Inbox indicators, Tinkery menu, Hide and the focused-agent setup shortcut.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
