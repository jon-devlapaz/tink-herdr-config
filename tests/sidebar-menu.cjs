const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../config");

function element() {
  const node = { items: [], handlers: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args.flat());
      else if (key === "id") node.key = args[0];
      else if (key === "on_click") node.handlers.click = args[0];
      else if (key === "on_mouse_down") node.handlers[args[0]] = args[1];
      else if (key === "on_key_down") node.handlers.key = args[0];
      return proxy;
    };
  } });
  return proxy;
}
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}
const agents = [
  { address: "t1", pane: "p1", tab: "b1", space: "s1", space_name: "Local", status: "idle", focused: true, program: { name: "Pi", key: "pi", agent: true }, seq: 1 },
  { address: "remote/t2", pane: "remote/p2", tab: "remote/b2", space: "remote/s2", space_name: "Remote", status: "done", focused: false, program: { name: "Pi", key: "pi", agent: true }, seq: 2 },
];
const terms = agents.map((a, i) => ({ address: a.address, state: "live", status: a.status, pid: 101 + i, turn: 4, labels: {} }));
const spaces = agents.map((a, i) => ({ id: a.space, name: a.space_name, machine: i ? "remote" : null, active: !i, tabs: [{ id: a.tab, name: "Named tab", named: true, active: true }] }));
const overlays = [], calls = [], jobs = [], labels = [];
let props = {}, pins = [], stopped = 0, failLabel = false;
const cx = { notify() {}, stop_propagation() { stopped++; }, focus_handle: () => ({ focus() {} }),
  timer: { every() {}, after() { return { cancel() {} }; } }, spawn(fn) { jobs.push(() => fn(cx)); } };
const env = {
  View: class {}, div: element, image: element, svg: element, v_flex: element, h_flex: element,
  Input: { new: element }, InputState: { new: () => ({ on() {}, value: () => "", focus() {} }) }, Popover: { new: element },
  agents: () => agents, terminals: () => terms, spaces: () => spaces,
  panes: () => agents.map((a) => ({ ...a, terminal: a.address, cwd: "/TEST", title: "pi" })),
  focused: () => ({ agent: "t1", pane: "p1", space: "s1", tab: "b1" }),
  props: () => props, theme: () => ({}), settings: () => ({}),
  shared: (key) => key === "agents.pins" ? pins : null, setShared() {}, setAgentOrder() {},
  layout: () => ({ id: "sidebar-lists", active: "lists" }),
  localStorage: { getItem: () => null, setItem() {} },
  nextCommand: () => new Promise(() => {}),
  run: (name, args) => calls.push([name, JSON.parse(JSON.stringify(args))]),
  openOverlay: (spec) => { overlays.push(JSON.parse(JSON.stringify(spec))); return "overlay"; },
  closeOverlay: (id) => calls.push(["close", id]),
  notify() {},
  hc: async (args) => { labels.push([...args]); return { code: failLabel ? 1 : 0, stderr: failLabel ? "TEST label failure" : "" }; },
};
function load(mod) {
  const dir = path.join(root, "mods", mod);
  const files = ["name.js", "tree.js", "main.js"].filter((file) => fs.existsSync(path.join(dir, file)));
  let source = files.map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/export (const|function) /g, "$1 ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext({ ...env }); vm.runInContext(source, context);
  const view = new context.Mod(); view.init({}, cx); return view;
}
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));
const target = "remote/t2";

(async () => {
  for (const [mod, id] of [["tinkery-agent-list", "ag-remote/t2"], ["tinkery-inbox", "card-remote/t2"]]) {
    props = {}; jobs.splice(0);
    const view = load(mod); view.workOpen = true;
    const row = find(view.render(cx), id);
    assert(row, `${mod} must render the target card`);
    assert.equal(typeof row.handlers.right, "function", `${mod} must handle right-click without hover`);
    const before = stopped; row.handlers.right({}, cx);
    assert.equal(stopped, before + 1);
    assert.deepEqual(overlays.splice(0), [{ mod: "tinkery-agent-menu", kind: "popup", at: "pointer", width: 260, props: { terminal: target } }]);
    assert.deepEqual(take(), [], "opening the menu must neither focus nor mutate an agent");
    assert.equal(labels.length, 0);
    row.handlers.click({}, cx);
    assert.deepEqual(take(), [["agent.focus", { terminal: target }]], "left-click still focuses the clicked agent");
    if (mod === "tinkery-agent-list") {
      terms.push({ address: "remote/t-sub", parent: target, state: "live", status: "blocked", pid: 200, labels: {} });
      const sub = find(view.render(cx), "sub-remote/t-sub"); assert(sub);
      sub.handlers.right({}, cx); assert.equal(overlays.splice(0)[0].props.terminal, "remote/t-sub");
      assert.deepEqual(take(), []); terms.pop();
    }
    if (mod === "tinkery-inbox") {
      terms[1].labels.settled = `${Date.now()}:4`; view.open = true;
      const slim = find(view.render(cx), "slim-remote/t2"); assert(slim);
      slim.handlers.right({}, cx); assert.equal(overlays.splice(0)[0].props.terminal, target);
      delete terms[1].labels.settled;
    }
  }
  jobs.splice(0); props = { terminal: target, overlay: "menu" };
  const menu = load("tinkery-agent-menu");
  assert.deepEqual(Array.from(menu.items(), (item) => item.key), ["tinkery", "rename", "settle", "stop"]);
  menu.choose("tinkery", cx);
  assert.equal(overlays.splice(0)[0].props.terminal, target); assert.deepEqual(take(), [["close", "menu"]]);
  const rename = load("tinkery-agent-menu"); rename.choose("rename", cx);
  assert.deepEqual(take(), [["close", "menu"], ["tab.rename", { id: "remote/b2" }]]);
  pins = [target]; assert(!load("tinkery-agent-menu").items().some((item) => item.key === "settle")); pins = [];
  terms.push({ address: "remote/t-child", parent: target, state: "live", status: "working", pid: 200, labels: {}, name: "TEST child" });
  assert(!load("tinkery-agent-menu").items().some((item) => item.key === "settle"));
  terms[2].status = "error"; assert(!load("tinkery-agent-menu").items().some((item) => item.key === "settle"));
  terms[2].status = "idle";
  terms.push({ address: "remote/t-kept", parent: target, state: "live", status: "idle", pid: 201, labels: { "herdr.space": "kept" }, name: "TEST kept" });
  const stopping = load("tinkery-agent-menu"); stopping.choose("stop", cx);
  const confirmation = overlays.splice(0)[0]; assert.equal(confirmation.mod, "tinkery-agent-menu");
  assert.equal(confirmation.props.confirmStop, true); assert.equal(confirmation.props.expectedPid, 102);
  assert.deepEqual(take(), [["close", "menu"]], "stop selection must not kill before confirmation");
  props = { ...confirmation.props, overlay: "confirm" };
  const confirm = load("tinkery-agent-menu");
  assert(confirm.stopDetail().includes("remote/t-child"));
  assert(confirm.stopDetail().includes("Kept"));
  assert(!confirm.stopDetail().includes("remote/t-kept"), "kept child is not listed as affected");
  find(confirm.render(cx), "agent-stop-cancel").handlers.click({}, cx);
  assert.deepEqual(take(), [["close", "confirm"]], "cancel never kills");
  const changed = load("tinkery-agent-menu"); terms[1].pid = 999;
  changed.confirmStop(cx); assert.deepEqual(take(), []); assert.match(changed.error ?? "", /changed/); terms[1].pid = 102;
  const valid = load("tinkery-agent-menu"); valid.confirmStop(cx);
  assert.deepEqual(take(), [["close", "confirm"], ["terminal.kill", { terminal: target }]]);
  terms.splice(2);
  props = { terminal: target, overlay: "menu" };
  const settling = load("tinkery-agent-menu"); settling.choose("settle", cx);
  while (jobs.length) await jobs.shift()();
  assert.equal(labels.splice(0)[0][1], target); take();
  terms[1].labels.settled = "1:4";
  const back = load("tinkery-agent-menu"); assert(back.items().some((item) => item.key === "bring-back"));
  back.choose("bring-back", cx); while (jobs.length) await jobs.shift()();
  assert.deepEqual(labels.splice(0)[0], ["label", target, "settled="]); take(); delete terms[1].labels.settled;
  const raced = load("tinkery-agent-menu"); raced.choose("settle", cx); agents[1].status = "working";
  while (jobs.length) await jobs.shift()();
  assert.match(raced.error ?? "", /changed/); assert.equal(labels.length, 0); assert.deepEqual(take(), []); agents[1].status = "done";
  const keyboard = load("tinkery-agent-menu");
  find(keyboard.render(cx), "agent-menu").handlers.key({ key: "down" }, cx);
  find(keyboard.render(cx), "agent-menu").handlers.key({ key: "enter" }, cx);
  assert.deepEqual(take(), [["close", "menu"], ["tab.rename", { id: "remote/b2" }]]);
  failLabel = true; const failing = load("tinkery-agent-menu"); failing.choose("settle", cx);
  while (jobs.length) await jobs.shift()();
  assert.match(failing.error ?? "", /TEST label failure/); assert.deepEqual(take(), []); failLabel = false; labels.splice(0);
  const stale = load("tinkery-agent-menu"); terms[1].state = "finished"; stale.choose("stop", cx);
  assert.deepEqual(take(), []); assert.equal(overlays.length, 0); terms[1].state = "live";
  const config = JSON.parse(fs.readFileSync(path.join(root, "layouts/tinkery-t3.json")));
  const mods = []; (function collect(node) { if (node.content?.mod) mods.push(node.content.mod); for (const c of node.children ?? []) collect(c); })(config);
  assert(mods.includes("tinkery-agent-list") && mods.includes("tinkery-inbox"), "both sidebar modes must use the personal handlers");
  const keys = JSON.parse(fs.readFileSync(path.join(root, "keys.json")));
  assert.equal(keys["layout:tinkery-t3"]["cmd-shift-s"], "tinkery-inbox.settle");
  console.log("ok: Lists/Inbox/settled right-click, exact remote targets, no focus on open, Tinkery/rename, live settle eligibility, PID-checked stop confirmation/cancel, failures and layout/key wiring.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
