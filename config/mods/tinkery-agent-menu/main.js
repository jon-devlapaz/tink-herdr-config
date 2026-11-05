import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, props, shared, run, hc, openOverlay, closeOverlay, theme } from "herdr";
import { descendants, ownStatus, kidStatus } from "./tree.js";

export default class AgentMenu extends View {
  init(_props, cx) {
    this.at = 0; this.pending = false; this.error = null;
    this.handle = cx.focus_handle(); this.handle.focus();
  }

  state() {
    const address = props()?.terminal, all = terminals();
    const terminal = all.find((t) => t.address === address && t.state === "live");
    if (!terminal) return null;
    const every = agents(), agent = every.find((a) => a.address === address);
    const children = descendants(all, address), listed = new Map(every.map((a) => [a.address, a.status]));
    const quiet = (word) => word === "idle" || word === "done";
    const pins = shared("agents.pins") ?? [];
    const canSettle = Boolean(agent) && quiet(ownStatus(agent.status, address, all))
      && children.every((child) => quiet(kidStatus(child, listed))) && !pins.includes(address)
      && Number.isSafeInteger(terminal.turn) && terminal.turn >= 0;
    const native = agent && panes().some((p) => p.pane === agent.pane && p.terminal === address && p.tab === agent.tab);
    return { address, terminal, agent, children, native, canSettle, settled: Boolean(terminal.labels?.settled) };
  }

  items() {
    const state = this.state();
    if (!state) return [];
    return [
      ...(state.native ? [{ key: "tinkery", label: "Open Tinkery…" }, { key: "rename", label: "Rename tab…" }]
        : [{ key: "show", label: "Show terminal" }]),
      ...(state.agent && state.settled ? [{ key: "bring-back", label: "Bring back" }]
        : state.canSettle ? [{ key: "settle", label: "Settle" }] : []),
      ...(Number.isSafeInteger(state.terminal.pid) && state.terminal.pid > 0
        ? [{ key: "stop", label: state.agent ? "! Stop agent…" : "! Stop terminal…" }] : []),
    ];
  }

  choose(key, cx) {
    if (this.pending) return;
    const state = this.state();
    if (!state || !this.items().some((item) => item.key === key)) { this.error = "The agent changed or is no longer available. Reopen its menu."; cx.notify(); return; }
    const { address } = state;
    this.pending = true; this.error = null;
    if (key === "tinkery") {
      closeOverlay(props().overlay);
      openOverlay({ mod: "tinkery-companion", kind: "window", key: `tinkery-setup:${address}`, width: 560, height: 420, props: { terminal: address } });
    } else if (key === "rename") {
      closeOverlay(props().overlay); run("tab.rename", { id: state.agent.tab });
    } else if (key === "show") {
      closeOverlay(props().overlay); run("terminal.peek", { terminal: address });
    } else if (key === "stop") {
      closeOverlay(props().overlay);
      openOverlay({ mod: "tinkery-agent-menu", kind: "dialog", width: 500, height: 360,
        props: { terminal: address, confirmStop: true, expectedPid: state.terminal.pid } });
    } else {
      cx.notify();
      cx.spawn(async (cx) => {
        try {
          const fresh = this.state();
          if (!fresh || !this.items().some((item) => item.key === key)) throw new Error("The agent changed state. Reopen its menu.");
          const value = key === "bring-back" ? "" : `${Date.now()}:${fresh.terminal.turn}`;
          const result = await hc(["label", address, `settled=${value}`]);
          if (result.code !== 0) throw new Error(result.stderr.trim() || "Herdr refused the label update.");
          closeOverlay(props().overlay);
        } catch (error) { this.pending = false; this.error = String(error); cx.notify(); }
      });
    }
  }

  stopDetail() {
    const state = this.state();
    if (!state) return "This terminal is no longer available. Nothing will be stopped.";
    const all = terminals(), affected = [], queue = [state.address], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const child of all) {
      if (child.parent !== queue[i] || child.state !== "live" || child.labels?.["herdr.space"] || seen.has(child.address)) continue;
      seen.add(child.address); queue.push(child.address); affected.push(child.address);
    }
    return `This stops ${state.address} and its then-running child terminals without kept panes.\n\n`
      + (affected.length ? `Currently affected children:\n${affected.map((address) => `• ${address}`).join("\n")}` : "No affected child terminals are currently listed.")
      + "\n\nKept child panes are spared. Running work will be interrupted. Settle does not stop a program; this does.";
  }

  confirmStop(cx) {
    if (this.pending) return;
    const state = this.state();
    if (!state || !Number.isSafeInteger(props()?.expectedPid) || state.terminal.pid !== props().expectedPid) {
      this.error = "The process changed or is no longer available. Nothing was stopped; reopen its menu."; cx.notify(); return;
    }
    this.pending = true;
    closeOverlay(props().overlay); run("terminal.kill", { terminal: state.address });
  }

  render(cx) {
    const t = theme(), p = props() ?? {}, items = this.items();
    const button = (id, label, action) => h_flex().id(id).h(32).px(10).rounded(6).items_center()
      .role("button").accessibility_label(label).disabled(this.pending).hover((style) => style.bg(t.hover))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => { cx.stop_propagation(); action(cx); }).child(label);
    if (p.confirmStop) return v_flex().id("agent-stop-confirm").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(p.overlay);
        else if (event.key === "enter") this.confirmStop(cx);
        else return;
        cx.stop_propagation();
      })
      .child(div().font_semibold().text_size(15).child(`Stop ${p.terminal}?`))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().whitespace_normal().text_color(t.muted).child(this.stopDetail()))
      .when(Boolean(this.error), (el) => el.child(div().whitespace_normal().text_color(t.ansi1).child(this.error)))
      .child(h_flex().gap(8).justify_end()
        .child(button("agent-stop-cancel", "Cancel", () => closeOverlay(p.overlay)))
        .child(button("agent-stop-confirm-button", "Stop", (cx) => this.confirmStop(cx)).text_color(t.ansi1)));
    this.at = Math.max(0, Math.min(this.at, items.length - 1));
    return v_flex().id("agent-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(p.overlay);
        else if (event.key === "down" && items.length) this.at = (this.at + 1) % items.length;
        else if (event.key === "up" && items.length) this.at = (this.at + items.length - 1) % items.length;
        else if (event.key === "enter" && items[this.at]) this.choose(items[this.at].key, cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(div().px(8).py(5).text_size(11).text_color(t.muted).child(p.terminal ?? "Agent unavailable"))
      .when(items.length === 0, (el) => el.child(div().px(8).py(8).text_color(t.muted).child("Agent no longer available.")))
      .children(items.map((item, index) => button(`agent-menu-${item.key}`, item.label, (cx) => this.choose(item.key, cx))
        .when(index === this.at, (el) => el.bg(t.selected)).when(item.key === "stop", (el) => el.text_color(t.ansi1))))
      .when(Boolean(this.error), (el) => el.child(div().px(8).py(5).whitespace_normal().text_color(t.ansi1).child(this.error)));
  }
}
