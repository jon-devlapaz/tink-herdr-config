// Tinkery's pane header: Herdr T3's t3-pane plus a right-click pane menu and Tinkery actions.
// Agent panes offer Open Tinkery…; a Tinkery pane offers Change checkout… and hides (keeps running)
// instead of closing. Icons are T3's own (mods/t3-pane/*.svg). Props from the app: { pane, terminal }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, agents, commands, focused, nextCommand, notify, props, run, openOverlay, theme, home, layout } from "herdr";
import { namer } from "./name.js";
import { ownStatus, subAgents, treeStatus } from "./tree.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Settled in the inbox isn't news, so its done dot goes, as in the tabs.
function settled(p) {
  const find = (n) => n?.id === "sidebar-lists" ? n : (n?.children ?? []).map(find).find(Boolean);
  return find(layout())?.active === "inbox" && Boolean(terminals().find((k) => k.address === p.terminal)?.labels?.settled);
}

function openTinkery(agent) {
  const setup = { mod: "tinkery-companion", key: `tinkery-setup:${agent}`, width: 560, height: 420, props: { terminal: agent } };
  if (commands().some((command) => command.name === "window.open_or_focus")) {
    run("window.open_or_focus", setup);
  } else {
    openOverlay({ ...setup, kind: "window" });
  }
}

function companionOwner(labels) {
  return labels?.["t3-tinkery.owner"] === "herdr" && typeof labels["t3-tinkery.agent"] === "string" ? labels["t3-tinkery.agent"] : null;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() !== "open-tinkery") continue;
        // Each visible header receives the command. Only the focused one may respond.
        const focus = focused();
        if (!focus?.pane || focus.pane !== props()?.pane) continue;
        const terminal = terminals().find((t) => t.address === (focus.shown ?? focus.terminal));
        if (terminal?.state === "live" && !companionOwner(terminal.labels)
          && agents().some((a) => a.pane === focus.pane && a.address === terminal.address)) {
          openTinkery(terminal.address);
        } else {
          notify({ title: "Focus an agent pane to open Tinkery." });
        }
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, label, action) {
    return div()
      .id(id)
      .size(26).flex_none().flex().items_center().justify_center()
      .rounded(6)
      .text_color(t.muted)
      .role("button").accessibility_label(label).tooltip(label)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(icon).size(14));
  }

  textButton(t, id, label, action) {
    return div().id(id).h(26).px(6).flex().items_center().rounded(6)
      .role("button").accessibility_label(label).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(); })
      .child(label);
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = namer()(p);
    const pic = icon(p.program, 14, t.muted);
    // Its agent with the sub-agents it started (tree.js).
    const all = terminals();
    const st = treeStatus(ownStatus(p.status, p.terminal, all), subAgents(agents(), all)(p.terminal));
    const pane = p.pane;
    const labels = all.find((k) => k.address === p.terminal)?.labels;
    const tinkeryAgent = companionOwner(labels);
    const agentPane = !tinkeryAgent && Boolean(p.terminal) && Boolean(p.program?.agent);
    // The rounded frame paints the background; rectangular child fills would cover its corners.
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(8)
      .gap(8)
      .items_center()
      .text_size(13)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", at: "pointer", width: 240, props: { tab: "pane", target: { pane, terminal: p.terminal } } });
      })
      .when(Boolean(pic), (el) => el.child(pic))
      .when(Boolean(p.terminal) && name !== p.terminal, (el) => el.child(div().flex_none().text_color(t.dim).child(p.terminal)))
      .child(div().flex_none().truncate().max_w(260).text_size(13).font_medium().text_color(p.focused ? t.foreground : t.muted).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      // The same marks as the agents list and tabs.
      .when(st === "blocked", el => el.child(div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().text_color(t.blocked).flex().items_center().justify_center().accessibility_label("Needs you").child("!")))
      .when(st === "done" && !settled(p), el => el.child(div().size(7).flex_none().rounded_full().bg(t.done)))
      .when(this.hovered, el => el.child(h_flex().flex_none().gap(4).items_center()
        .when(agentPane, (row) => row.child(this.textButton(t, `ph-tinkery-${pane}`, "Open Tinkery…", () => openTinkery(p.terminal))))
        .when(Boolean(tinkeryAgent), (row) => row.child(this.textButton(t, `ph-checkout-${pane}`, "Change checkout…", () => openTinkery(tinkeryAgent))))
        .child(this.button(t, `ph-r-${pane}`, "mods/t3-pane/split-right.svg", "Split right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "mods/t3-pane/split-down.svg", "Split down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, `mods/t3-pane/${p.zoomed ? "unzoom" : "zoom"}.svg`, p.zoomed ? "Unzoom pane" : "Zoom pane", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "mods/t3-pane/close.svg", tinkeryAgent ? "Hide Tinkery (keeps running)" : "Close pane",
          () => tinkeryAgent ? run("terminal.park", { terminal: p.terminal }) : run("pane.close", { pane })))));
  }
}
