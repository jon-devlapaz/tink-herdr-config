import { View, div, svg } from "gpui-kit";
import { theme, run, appHome, readTextFile, writeTextFile, nextCommand, notify } from "herdr";
import { nextLook, updateLook } from "./look.js";

export default class ThemeToggle extends View {
  init(_props, cx) {
    this.switching = false;
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() === "toggle") await this.toggle(cx);
      }
    });
  }

  async toggle(cx) {
    if (this.switching) return;
    this.switching = true;
    cx.notify();
    try {
      const look = nextLook(theme().background);
      const path = `${appHome()}/settings.json`;
      const source = await readTextFile(path);
      if (source === null) throw new Error("Herdr settings.json is missing");
      await writeTextFile(path, updateLook(source, look), source);
      run("app.theme", { name: look.theme });
    } catch (error) {
      notify({ title: "Theme switch failed", body: String(error), level: "error" });
    } finally {
      this.switching = false;
      cx.notify();
    }
  }

  render() {
    const t = theme();
    const target = nextLook(t.background).appearance;
    const label = this.switching ? "Switching theme…" : `Switch to ${target} mode`;
    return div().size_full().flex().items_center().justify_center().bg(t.chrome)
      .child(div().id("tinkery-theme-toggle").size(26).rounded(6).flex()
        .items_center().justify_center().text_color(t.muted)
        .cursor_pointer().hover(el => el.bg(t.hover).text_color(t.foreground))
        .role("button").accessibility_label(label).tooltip(label)
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click((_event, cx) => cx.spawn(async cx => this.toggle(cx)))
        .child(svg(this.switching ? "mods/workspace-chrome/spinner.svg" : `mods/tinkery-theme/${target === "light" ? "sun" : "moon"}.svg`).size(16)
          .when(this.switching, el => el.spin(900))));
  }
}
