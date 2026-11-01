const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modRoot = path.resolve(__dirname, '../config/mods/tinkery-theme');

function element(source) {
  const n = { source, children: [], handlers: {}, attrs: {} };
  const p = new Proxy(n, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') n.children.push(args[0]);
      else if (key === 'when') { if (args[0]) args[1](p); }
      else if (key === 'hover') args[0](element());
      else if (key === 'on_click') n.handlers.click = args[0];
      else if (key === 'on_mouse_down') n.handlers.down = args[1];
      else n.attrs[key] = args[0];
      return p;
    };
  } });
  return p;
}
function fixture(background = '#141418') {
  let source = JSON.stringify({ zoom: 0.9, appearance: 'dark', sounds: { enabled: true } });
  const calls = [], notifications = [], tasks = [];
  let writes = 0, failure = null;
  const env = {
    View: class {}, div: () => element(), svg: element,
    theme: () => ({ background }), appHome: () => '/fixture',
    readTextFile: async p => { assert.equal(p, '/fixture/settings.json'); return source; },
    writeTextFile: async (p, text, expected) => {
      assert.equal(p, '/fixture/settings.json');
      assert.equal(expected, source);
      if (failure) throw new Error(failure);
      writes++; source = text;
    },
    run: (name, args) => calls.push([name, args]),
    notify: n => notifications.push(n), nextCommand: () => new Promise(() => {}),
  };
  const cx = { notify() {}, stop_propagation() {}, spawn: fn => { tasks.push(fn(cx)); } };
  const context = vm.createContext(env);
  const code = ['look.js', 'main.js'].map(f => fs.readFileSync(path.join(modRoot, f), 'utf8')).join('\n')
    .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ')
    .replace('export default class', 'globalThis.Mod = class');
  vm.runInContext(code, context);
  const mod = new context.Mod(); mod.init({}, cx);
  return { mod, cx, context, calls, notifications, tasks,
    get source() { return source; }, set source(v) { source = v; },
    get writes() { return writes; }, set failure(v) { failure = v; } };
}
const plain = x => JSON.parse(JSON.stringify(x));
(async () => {
  for (const [bg, target, icon] of [['#141418', 'light', 'sun'], ['#ffffff', 'dark', 'moon']]) {
    const f = fixture(bg), button = f.mod.render().children[0];
    assert.equal(button.children[0].source, `mods/tinkery-theme/${icon}.svg`);
    assert.equal(button.attrs.accessibility_label, `Switch to ${target} mode`);
    let stopped = false;
    button.handlers.down({}, { stop_propagation() { stopped = true; } });
    assert.ok(stopped, 'button does not drag window');
    button.handlers.click({}, f.cx);
    await Promise.all(f.tasks.slice(1));
    assert.equal(f.writes, 1);
    assert.deepEqual(plain(f.calls), [['app.theme', { name: `tinkery-${target}` }]]);
    const settings = JSON.parse(f.source);
    assert.equal(settings.appearance, target);
    assert.equal(settings.theme, `tinkery-${target}`);
    assert.equal(settings.zoom, 0.9);
    assert.deepEqual(settings.sounds, { enabled: true });
    assert.equal(f.mod.switching, false);
  }
  {
    const f = fixture();
    const a = f.mod.toggle(f.cx), b = f.mod.toggle(f.cx);
    await Promise.all([a, b]);
    assert.equal(f.writes, 1, 'repeated clicks do not double-toggle');
    assert.equal(f.notifications.length, 0, 'repeated clicks do not race the settings write');
  }
  for (const source of [null, '{broken', '[]']) {
    const f = fixture(); f.source = source;
    await f.mod.toggle(f.cx);
    assert.equal(f.writes, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.notifications[0].level, 'error');
    assert.equal(f.mod.switching, false);
  }
  {
    const f = fixture(); f.failure = 'stale snapshot';
    await f.mod.toggle(f.cx);
    assert.equal(f.calls.length, 0, 'failed settings write must not apply theme');
    assert.equal(f.notifications[0].level, 'error');
    assert.equal(f.mod.switching, false);
  }
  assert.throws(() => fixture().context.nextLook('invalid'));
  for (const icon of ['sun', 'moon']) assert.ok(fs.existsSync(path.join(modRoot, `${icon}.svg`)));
  assert.ok(process.argv[2], 'Supply the isolated installed fixture home');
  const home = path.resolve(process.argv[2]);
  const layout = JSON.parse(fs.readFileSync(path.join(home, 'layouts/tinkery-t3.json')));
  const upstream = JSON.parse(fs.readFileSync(path.join(home, 'layouts/herdr-t3.json')));
  const upstreamTop = upstream.children.find(n => n.id === 'work').children[0];
  assert.equal(upstreamTop.id, 'tabs');
  assert.equal(upstreamTop.content.mod, 't3-tabs');
  assert.ok(!JSON.stringify(upstream).includes('tinkery-theme'), 'upstream layout stays independent of personal button');
  const top = layout.children.find(n => n.id === 'work').children[0];
  assert.equal(top.children[0].content.mod, 't3-tabs');
  assert.equal(top.children.at(-1).content.mod, 'tinkery-theme');
  const keys = JSON.parse(fs.readFileSync(path.join(home, 'keys.json')));
  for (const name of ['herdr-t3', 'tinkery-t3']) {
    assert.deepEqual(keys[`layout:${name}`], {
      'cmd-shift-b': 't3-chrome.sidebar',
      'cmd-shift-a': 't3-tabs.view',
    });
  }
  console.log('ok: sun/moon rendering, click behavior, both themes, settings preservation, repeat-click guard, errors, layout and no T3 theme shortcut');
})().catch(e => { console.error(e); process.exitCode = 1; });
