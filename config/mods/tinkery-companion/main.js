import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, spaces, props, pickFolder, exec, hc, run, layout, closeOverlay, theme } from "herdr";

const OWNER = "herdr";
const LABEL = "t3-tinkery";

export default class Tinkery extends View {
  init(_props, cx) {
    this.busy = false; this.picking = false; this.error = null; this.didShow = false;
    this.pathInput = InputState.new({ placeholder: "Absolute checkout path on the remote machine" });
    this.override = null; this.editingPath = false; this.pendingShow = null;
    this.pathTarget = this.target();
    this.pathInput.on("submit", (_event, cx) => this.useRemoteCheckout(cx));
  }

  target() {
    const terminal = props()?.terminal;
    const agent = agents().find((a) => a.address === terminal);
    const space = agent && spaces().find((s) => s.id === agent.space);
    const live = terminals().find((t) => t.address === terminal && t.state === "live");
    if (!agent || !space || !live) return null;
    const pane = panes().find((p) => p.pane === agent.pane && p.terminal === terminal);
    const reported = pane?.cwd ?? live.cwd;
    const target = { terminal, on: space.machine, name: agent.title || terminal, project: space.name };
    return { ...target, pane: pane?.pane, tab: pane?.tab, space: space.id, cwd: this.validPath(reported, target) ? reported : null };
  }

  sameTarget(target) {
    const current = this.target();
    return current && current.terminal === target?.terminal && current.on === target?.on
      && current.pane === target?.pane && current.tab === target?.tab;
  }

  checkWorkspace(target) {
    if (!this.sameTarget(target) || !target.pane || !target.tab) throw new Error("The selected agent's native pane is unavailable or changed.");
    const find = (node) => node?.id === "main" && node.content?.tab === "active" ? node : (node?.children ?? []).map(find).find(Boolean);
    if (!find(layout()))
      throw new Error("This layout has no main tab workspace. No terminal was moved or started.");
  }

  existing(target) {
    if (!target) return null;
    return terminals().find((t) => t.state === "live"
      && t.labels?.[`${LABEL}.owner`] === OWNER
      && t.labels?.[`${LABEL}.agent`] === target.terminal
      && (target.on
        ? t.labels?.[`${LABEL}.machine`] === target.on && t.address.startsWith(target.on + "/")
        : (t.labels?.[`${LABEL}.machine`] === undefined || t.labels[`${LABEL}.machine`] === "") && !t.address.includes("/"))
      && typeof t.labels?.[`${LABEL}.checkout`] === "string");
  }

  validPath(path, target) {
    return typeof path === "string" && !/[\x00-\x1f\x7f]/.test(path)
      && (path.startsWith("/") || (!target.on && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)));
  }

  checkoutFor(target) {
    if (!target) return null;
    if (this.override) return this.override.terminal === target.terminal && this.override.on === target.on ? this.override.cwd : null;
    return target.cwd;
  }

  applyCheckout(checkout, target, cx) {
    if (!this.sameTarget(target)) { this.error = "The selected agent changed machine or became unavailable."; cx.notify(); return; }
    if (!this.validPath(checkout, target)) { this.error = "Choose an absolute checkout path; no path is guessed or expanded."; cx.notify(); return; }
    this.override = { terminal: target.terminal, on: target.on, cwd: checkout };
    this.editingPath = false; this.error = null; cx.notify();
  }

  chooseCheckout(cx) {
    if (this.busy || this.picking || this.pendingShow) return;
    const target = this.target();
    if (!target) { this.error = "The selected agent is unavailable."; cx.notify(); return; }
    this.error = null;
    if (target.on) {
      this.pathTarget = target; this.editingPath = true;
      this.pathInput.set_value(this.checkoutFor(target) ?? ""); this.pathInput.focus(); cx.notify();
      return;
    }
    this.picking = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const checkout = await pickFolder({ prompt: "Use this checkout for Tinkery" });
        if (checkout !== null) this.applyCheckout(checkout, target, cx);
      } catch (error) { this.error = String(error); }
      finally { this.picking = false; cx.notify(); }
    });
  }

  useRemoteCheckout(cx) {
    if (this.busy || this.picking) return;
    if (!this.pathTarget?.on) { this.error = "Choose a path on the selected agent's machine."; cx.notify(); return; }
    this.applyCheckout(this.pathInput.value(), this.pathTarget, cx);
  }

  openDefault(cx) {
    if (this.busy || this.picking || this.pendingShow) return;
    const target = this.target(), existing = this.existing(target);
    if (existing && !this.override) { this.showExisting(cx); return; }
    const checkout = this.checkoutFor(target);
    if (!checkout) { this.error = "The agent's folder is unavailable. Choose a checkout explicitly."; cx.notify(); return; }
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => { this.busy = false; await this.launch(checkout, target, cx); });
  }

  async launch(checkout, target, cx) {
    if (this.busy) return;
    this.error = null;
    if (!this.sameTarget(target)) { this.error = "The selected agent is unavailable or changed machine."; cx.notify(); return; }
    if (!this.validPath(checkout, target)) {
      this.error = "Choose an absolute checkout path; no path is guessed or expanded."; cx.notify(); return;
    }
    try { this.checkWorkspace(target); }
    catch (error) { this.error = String(error); cx.notify(); return; }
    const existing = this.existing(target);
    if (existing) {
      if (existing.labels[`${LABEL}.checkout`] === checkout) this.show(existing.address, target);
      else { this.error = "Tinkery is already running for another checkout. Show it below, or quit it before opening another."; cx.notify(); }
      return;
    }
    this.busy = true; cx.notify();
    try {
      const help = await exec("tinkery", ["--help"], { cwd: checkout, on: target.on });
      if (help.code !== 0) throw new Error(help.stderr.trim() || "Tinkery is not available on the selected machine.");
      for (const flag of ["--home", "--operator", "--sdlc-root"])
        if (!help.stdout.includes(flag)) throw new Error(`The installed Tinkery does not advertise ${flag}. No terminal was started.`);
      if (!this.sameTarget(target)) throw new Error("The selected agent changed or became unavailable before launch.");
      const name = "tinkery-" + target.terminal.replace(/[^a-z0-9_-]/gi, "-").toLowerCase().slice(-24);
      const args = ["run", "--json", "--bg", "--name", name, "--cwd", checkout,
        ...(target.on ? ["--on", target.on] : []),
        "--label", `${LABEL}.owner=${OWNER}`,
        "--label", `${LABEL}.agent=${target.terminal}`,
        "--label", `${LABEL}.checkout=${checkout}`,
        ...(target.on ? ["--label", `${LABEL}.machine=${target.on}`] : []),
        "--", "tinkery", "--home", "--operator", "human", "--sdlc-root", checkout];
      const result = await hc(args);
      if (result.code !== 0) throw new Error(result.stderr.trim() || "Tinkery's terminal could not be started.");
      let started;
      try { started = JSON.parse(result.stdout); }
      catch { throw new Error("Herdr returned an unreadable launch response. Check hc ls before retrying."); }
      const address = started.address;
      if (started.state !== "live" || typeof address !== "string" || !/^(?:[a-z0-9_-]+\/)?t[a-z0-9_-]+$/i.test(address)
        || (target.on ? !address.startsWith(target.on + "/") : address.includes("/"))) {
        throw new Error("Herdr did not confirm a live terminal on the selected machine. Check hc ls before retrying.");
      }
      this.show(address, target);
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; if (!this.didShow) cx.notify(); }
  }

  showExisting(cx) {
    const target = this.target(), existing = this.existing(target);
    if (!existing) { this.error = "The Tinkery terminal is no longer available."; cx.notify(); return; }
    this.show(existing.address, target);
  }

  show(companion, target) {
    this.pendingShow = { companion, target, requested: false };
    this.advancePlacement();
  }

  advancePlacement() {
    const pending = this.pendingShow;
    if (!pending) return;
    try {
      const { companion, target } = pending;
      this.checkWorkspace(target);
      const terminal = terminals().find((t) => t.address === companion);
      if (!terminal) return;
      if (terminal.state !== "live") throw new Error("Tinkery exited before it could be placed. Check its terminal before retrying.");
      const pane = panes().find((p) => p.terminal === companion);
      if (pane && pane.tab !== target.tab) throw new Error("Tinkery already has a pane in another tab. It was not moved or restarted.");
      if (!pending.requested) {
        pending.requested = true;
        run("agent.focus", { terminal: target.terminal });
        run("pane.focus", { pane: target.pane });
        const zoomed = panes().find((p) => p.tab === target.tab && p.zoomed);
        if (zoomed) run("pane.zoom", { pane: zoomed.pane });
        if (!pane) run("terminal.keep", { terminal: companion, place: "right" });
      }
      if (panes().some((p) => p.terminal === companion && p.tab === target.tab)) {
        this.pendingShow = null; this.didShow = true;
        if (props()?.overlay) closeOverlay(props().overlay);
      }
    } catch (error) { this.pendingShow = null; this.error = String(error); }
  }

  render() {
    if (this.pendingShow) this.advancePlacement();
    const t = theme(), p = props() ?? {};
    const stop = (_event, cx) => cx.stop_propagation();
    const button = (id, label, action) => h_flex().id(id).h(30).px(10).rounded(6).items_center()
      .role("button").accessibility_label(label).text_color(t.foreground).hover((style) => style.bg(t.hover))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const target = this.target(), existing = this.existing(target), checkout = this.checkoutFor(target);
    return v_flex().id("tinkery-setup").size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().gap(8).items_center().child(div().font_semibold().text_size(16).child("Tinkery beside the agent"))
        .child(div().flex_1()).when(Boolean(p.overlay), (el) => el.child(button("tinkery-cancel", "Close", () => closeOverlay(p.overlay)))))
      .child(div().text_color(t.muted).child(target ? `${target.project} · ${target.terminal} · ${target.on ?? "this computer"}` : "Selected agent unavailable."))
      .child(div().child("Uses your normal Tinkery goals, saved model, and saved call allowance. Submitted model requests may cost money; opening this view sends no prompts."))
      .child(div().whitespace_normal().child(`${this.override ? "Selected checkout" : "Agent folder"}: ${checkout ?? "unavailable"}`))
      .child(div().text_color(t.muted).child("Defaults to the agent's reported folder. No repository discovery or Git initialization. No conversation or goal is imported."))
      .when(Boolean(existing), (el) => el
        .child(div().whitespace_normal().text_color(t.muted).child(`Already running for: ${existing.labels[`${LABEL}.checkout`]}`))
        .child(button("tinkery-show", "Show existing Tinkery", (_event, cx) => this.showExisting(cx))))
      .when(Boolean(target), (el) => el
        .child(h_flex().gap(8).items_center()
          .when(!existing && Boolean(checkout), (row) => row.child(button("tinkery-open", this.busy ? "Opening…" : "Open Tinkery", (_event, cx) => this.openDefault(cx)).disabled(this.busy || this.picking)))
          .child(button("tinkery-choose", checkout ? "Change checkout…" : "Choose checkout…", (_event, cx) => this.chooseCheckout(cx)).disabled(this.busy || this.picking)))
        .when(Boolean(target.on) && (this.editingPath || !checkout), (el) => el
          .child(div().child(`Absolute checkout path on ${target.on}:`))
          .child(Input.new(this.pathInput).h(32).text_size(13).text_color(t.foreground))
          .child(button("tinkery-use-checkout", "Use checkout", (_event, cx) => this.useRemoteCheckout(cx))))
        .when(Boolean(existing) && Boolean(this.override) && existing.labels[`${LABEL}.checkout`] !== checkout,
          (el) => el.child(div().whitespace_normal().text_color(t.muted).child("Quit the running Tinkery from its own menu before opening the selected checkout. Nothing is stopped or restarted automatically."))))
      .when(Boolean(this.pendingShow), (el) => el
        .child(div().whitespace_normal().child("Waiting for Herdr to confirm the native split. Any placement failure is reported by Herdr; neither program is stopped."))
        .child(button("tinkery-retry-placement", "Retry placement", (_event, cx) => { if (this.pendingShow) this.pendingShow.requested = false; this.advancePlacement(); cx.notify(); })))
      .when(Boolean(this.error), (el) => el.child(div().whitespace_normal().text_color(t.ansi1).child(`! ${this.error}`)))
      .child(div().mt_auto().text_size(11).text_color(t.dim).child("Drag the native divider to resize. Hide Tinkery removes its pane without stopping it."));
  }
}
