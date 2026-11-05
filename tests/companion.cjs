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
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "id") node.key = args[0];
      else if (key === "on_click") node.handlers.click = args[0];
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
function texts(node) {
  if (typeof node === "string") return [node];
  return node && typeof node === "object" ? (node.items ?? []).flatMap(texts) : [];
}
const agent = { address: "t1", pane: "p1", space: "s1", title: "Writer" };
const all = [{ address: "t1", state: "live", labels: {} }];
const calls = [], nativeCalls = [], executions = [], overlays = [], closed = [], jobs = [];
let staged = null, placed = null, delayKeep = false, workspaceAvailable = true;
let machine = null, cwd = "/agent reported folder", paneAvailable = true;
let picked = "/chosen checkout", pickerCalls = 0, failHelp = false, failRun = false;
let helpText = "--home --operator --shape-budget --sdlc-root", beforeRun;
let props = { terminal: "t1", overlay: "setup" };
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), spawn(fn) { jobs.push(() => fn(cx)); } };
const context = vm.createContext({
  View: class {}, div: element, h_flex: element, v_flex: element,
  Input: { new: element }, InputState: { new: () => { let value = ""; return { on() {}, value: () => value, set_value(v) { value = v; }, focus() {} }; } },
  agents: () => [agent], terminals: () => staged ? [...all, staged] : all,
  panes: () => [...(paneAvailable ? [{ pane: "p1", terminal: agent.address, cwd, tab: "b1" }] : []), ...(placed ? [placed] : [])],
  layout: () => workspaceAvailable ? { id: "root", children: [{ id: "work-body", children: [{ id: "main", content: { tab: "active" } }] }] } : { id: "other-layout" },
  focused: () => { throw new Error("must never use another focused terminal's directory"); },
  spaces: () => [{ id: "s1", name: "Project", machine, folder: "/not-the-agent-folder" }],
  props: () => props, theme: () => ({}),
  pickFolder: async () => { pickerCalls++; return picked; },
  exec: async (command, args, options) => {
    executions.push({ command, args: [...args], options: { ...options } });
    assert.equal(command, "tinkery", "no Git initialization, repository discovery, or shell guesses");
    assert.deepEqual([...args], ["--help"]);
    beforeRun?.();
    return { code: failHelp ? 1 : 0, stdout: helpText, stderr: failHelp ? "not installed" : "" };
  },
  hc: async (args) => {
    calls.push([...args]);
    assert.equal(args[0], "run", "must not send keys, stop agents, or run unrelated commands");
    if (failRun) return { code: 1, stdout: "", stderr: "fixture launch failed" };
    staged = { address: machine ? `${machine}/t-new` : "t-new", state: "live", labels: {} };
    for (let i = 0; i < args.length; i++) if (args[i] === "--label") {
      const [key, ...value] = args[i + 1].split("="); staged.labels[key] = value.join("=");
    }
    return { code: 0, stdout: JSON.stringify(staged), stderr: "" };
  },
  run: (name, args) => {
    nativeCalls.push([name, JSON.parse(JSON.stringify(args))]);
    assert(["agent.focus", "pane.focus", "terminal.keep", "pane.zoom"].includes(name), "never close, kill, relaunch, or message a running program");
    if (name === "terminal.keep" && !delayKeep) placed = { pane: "p-tinkery", terminal: args.terminal, tab: "b1" };
  },
  openOverlay: (spec) => { overlays.push(JSON.parse(JSON.stringify(spec))); return "companion"; },
  closeOverlay: (id) => closed.push(id),
});
let source = fs.readFileSync(path.join(root, "mods/tinkery-companion/main.js"), "utf8").replace(/^import .*;\r?\n/gm, "");
source = source.replace("export default class", "globalThis.Mod = class");
vm.runInContext(source, context);
function setup() { const view = new context.Mod(); view.init({}, cx); return view; }
async function flush() { while (jobs.length) await jobs.shift()(); }
function takeLaunch(checkout, on = null) {
  const launches = calls.splice(0);
  assert.equal(launches.length, 1, "expected exactly one launch");
  const args = launches[0];
  assert(args.includes("--json") && args.includes("--bg"));
  assert.equal(args[args.indexOf("--cwd") + 1], checkout);
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["tinkery", "--home", "--operator", "human", "--sdlc-root", checkout]);
  for (const flag of ["--shape-budget", "--shape-pi", "--harness", "--model", "--thinking"])
    assert(!args.includes(flag), `saved Tinkery settings must not be overridden by ${flag}`);
  if (on) assert.equal(args[args.indexOf("--on") + 1], on);
  else assert(!args.includes("--on"));
  assert(!args.includes("--outlive-parent"));
  assert(!args.includes("t3-tinkery.machine="), "local routing must not depend on an empty label that hc removes");
  assert.deepEqual(overlays.splice(0), [], "native workspace, not an overlay composition");
  assert.deepEqual(nativeCalls.splice(0), [
    ["agent.focus", { terminal: agent.address }],
    ["pane.focus", { pane: "p1" }],
    ["terminal.keep", { terminal: on ? `${on}/t-new` : "t-new", place: "right" }],
  ]);
  assert.equal(placed?.tab, "b1");
  staged = null; placed = null;
  assert.deepEqual(closed.splice(0), ["setup"]);
  assert.equal(executions.at(-1).options.cwd, checkout);
  assert.equal(executions.at(-1).options.on, on);
}

(async () => {
  const view = setup();
  assert.equal(calls.length, 0); assert.equal(executions.length, 0); assert.equal(jobs.length, 0); assert.equal(pickerCalls, 0);
  assert(find(view.render(cx), "tinkery-open"));
  assert(find(view.render(cx), "tinkery-choose"));
  assert(texts(view.render(cx)).join(" ").includes(`Agent folder: ${cwd}`));
  cwd = "/updated reported folder";
  view.openDefault(cx); view.openDefault(cx); await flush();
  assert.equal(view.error, null); assert.equal(pickerCalls, 0);
  takeLaunch(cwd);

  all.push({ address: "t-new", state: "live", labels: { "t3-tinkery.owner": "herdr", "t3-tinkery.agent": "t1", "t3-tinkery.checkout": cwd } });
  const reused = setup(); const beforeHelp = executions.length;
  reused.openDefault(cx); await flush();
  assert.equal(calls.length, 0); assert.equal(pickerCalls, 0); assert.equal(executions.length, beforeHelp);
  assert.equal(overlays.splice(0).length, 0); closed.splice(0);
  assert.equal(nativeCalls.splice(0).at(-1)[0], "terminal.keep");
  reused.openDefault(cx); await flush();
  assert.deepEqual(nativeCalls.splice(0), [["agent.focus", { terminal: "t1" }], ["pane.focus", { pane: "p1" }]]);
  closed.splice(0);
  reused.applyCheckout("/another checkout", reused.target(), cx);
  reused.openDefault(cx); await flush();
  assert(reused.error.includes("already")); assert.equal(calls.length, 0);

  assert.equal(calls.length, 0); all.pop(); placed = null;

  all.push({ address: "t-new", state: "live", labels: { "t3-tinkery.owner": "herdr", "t3-tinkery.agent": "t1", "t3-tinkery.checkout": cwd } });
  delayKeep = true;
  const waiting = setup(); waiting.openDefault(cx); await flush();
  assert.equal(closed.length, 0, "do not claim placement before the native pane exists");
  waiting.render(cx); waiting.render(cx);
  assert.equal(nativeCalls.filter(([name]) => name === "terminal.keep").length, 1, "native updates must not duplicate adoption");
  placed = { pane: "p-tinkery", terminal: "t-new", tab: "b1" };
  waiting.render(cx);
  assert.deepEqual(closed.splice(0), ["setup"]); nativeCalls.splice(0);
  placed.tab = "unrelated-tab";
  const wrongTab = setup(); wrongTab.openDefault(cx); await flush();
  assert.match(wrongTab.error ?? "", /another tab/);
  assert.equal(nativeCalls.length, 0, "never move another tab's terminal implicitly");
  all.pop(); placed = null; delayKeep = false;

  const changed = setup(); changed.chooseCheckout(cx); changed.chooseCheckout(cx); await flush();
  assert.equal(pickerCalls, 1); assert.equal(calls.length, 0, "changing checkout is not launch permission");
  assert.equal(changed.checkoutFor(changed.target()), picked);
  assert(texts(changed.render(cx)).join(" ").includes(`Selected checkout: ${picked}`));
  cwd = "/agent moved again";
  picked = null; changed.chooseCheckout(cx); await flush();
  assert.equal(changed.checkoutFor(changed.target()), "/chosen checkout", "cancel preserves the explicit override");
  changed.openDefault(cx); await flush(); takeLaunch("/chosen checkout");

  cwd = null;
  const unknown = setup();
  assert.equal(find(unknown.render(cx), "tinkery-open"), null);
  assert(find(unknown.render(cx), "tinkery-choose"));
  picked = "/explicit when unavailable";
  unknown.chooseCheckout(cx); await flush();
  assert.equal(calls.length, 0);
  unknown.openDefault(cx); await flush(); takeLaunch(picked);
  paneAvailable = false; all[0].cwd = "/core reported folder";
  assert.equal(setup().target().cwd, all[0].cwd);
  paneAvailable = true; delete all[0].cwd;

  agent.address = "remote/t1"; all[0].address = agent.address; props.terminal = agent.address;
  machine = "remote"; cwd = "/remote reported folder";
  const remote = setup(); const remotePicker = pickerCalls;
  remote.openDefault(cx); await flush(); takeLaunch(cwd, machine);
  assert.equal(pickerCalls, remotePicker);
  const remoteOverride = setup(); remoteOverride.chooseCheckout(cx);
  remoteOverride.pathInput.set_value("/remote override"); remoteOverride.useRemoteCheckout(cx);
  assert.equal(calls.length, 0);
  remoteOverride.openDefault(cx); await flush(); takeLaunch("/remote override", machine);
  assert.equal(pickerCalls, remotePicker);

  cwd = null;
  const invalid = setup(); invalid.pathInput.set_value("~/guessed"); invalid.useRemoteCheckout(cx);
  assert(invalid.error.includes("absolute")); assert.equal(calls.length, 0);
  const moved = setup(); moved.chooseCheckout(cx); moved.pathInput.set_value("/remote-only"); machine = null;
  moved.useRemoteCheckout(cx);
  assert(moved.error.includes("changed")); assert.equal(moved.override, null); machine = "remote";

  workspaceAvailable = false;
  const noWorkspace = setup(); const beforeCommands = executions.length;
  await noWorkspace.launch("/remote checkout", noWorkspace.target(), cx);
  assert(noWorkspace.error.includes("main tab workspace")); assert.equal(calls.length, 0); assert.equal(executions.length, beforeCommands);
  workspaceAvailable = true; paneAvailable = false;
  const noPane = setup(); await noPane.launch("/remote checkout", noPane.target(), cx);
  assert(noPane.error.includes("native pane")); assert.equal(calls.length, 0);
  paneAvailable = true;

  const config = JSON.parse(fs.readFileSync(path.join(root, "layouts/tinkery-t3.json"), "utf8"));
  const node = (root, id) => root.id === id ? root : (root.children ?? []).map((child) => node(child, id)).find(Boolean);
  assert.equal(node(config, "main").content.tab, "active");
  assert(node(config, "main").content.pane.gap <= 4, "minimal native pane spacing");
  assert(node(config, "work-body").padding.every((n) => n <= 2), "minimal workspace gutters");
  assert(config.terminal_padding.every((n) => n <= 2), "minimal terminal padding");

  const failed = setup(); failHelp = true;
  await failed.launch("/remote checkout", failed.target(), cx);
  assert(failed.error); assert.equal(calls.length, 0); failHelp = false;
  const unsupported = setup(); helpText = "--home";
  await unsupported.launch("/remote checkout", unsupported.target(), cx);
  assert(unsupported.error.includes("does not advertise")); assert.equal(calls.length, 0);
  helpText = "--home --operator --shape-budget --sdlc-root";
  failRun = true; const failedRun = setup();
  await failedRun.launch("/remote checkout", failedRun.target(), cx);
  assert(failedRun.error.includes("fixture launch failed")); assert.equal(overlays.length, 0);
  calls.splice(0); failRun = false;
  const ended = setup(); beforeRun = () => { all[0].state = "finished"; };
  await ended.launch("/remote checkout", ended.target(), cx);
  assert(ended.error.includes("changed") || ended.error.includes("unavailable")); assert.equal(calls.length, 0);
  console.log("ok: reported-folder defaults, explicit overrides, no discovery/init, missing folders, local-label reuse, remote routing, native saved model/budget settings, stale targets, native target-safe splits, asynchronous adoption and no overlay/duplicate placement.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
