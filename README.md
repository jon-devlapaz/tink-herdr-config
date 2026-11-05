# tink-herdr-config

Personal Tinkery Herdr Desktop configuration, licensed under Apache-2.0.
Publishing or updating this repository does not deploy it to a live app.

For agent-driven edits, dependency updates, deployment, or recovery, read
[AGENTS.md](AGENTS.md) for safety boundaries and known gaps.

## Source and runtime stay separate

This checkout is the source of truth for the personal `tinkery-t3`
layout, theme-button, pane-header and Tinkery companion mods, Tinkery
light/dark themes, and declared keybindings.
The live Herdr home is a deployment target, never a symlink to this checkout.
This follows tink-pi-config's source/runtime separation and explicit verification;
it does not configure Pi or introduce an agent-orchestration layer.

Herdr Desktop runs the window; herdr-core (`hc`) runs terminals. No daemon,
provider bridge, updater job, or background synchronizer is added here.

## Included behavior

- Personal forks of T3's Lists and Inbox sidebars, with `cmd-shift-b` to switch and
  `cmd-shift-s` to settle the agent in view. `cmd-shift-enter` zooms a pane.
  Right-click an agent card for **Open Tinkery…**, **Rename tab…**, eligible
  **Settle / Bring back**, and **Stop agent…**. Opening the menu does not select
  the agent. Stopping requires confirmation, lists affected children, spares kept
  child panes, and refuses if the process changed while the dialog was open.
- Click **Shortcuts** beside the sun/moon button (or press `cmd-/`) to see
  all configured shortcuts. Type to filter the list and press Esc to close it.
- In `tinkery-t3`, `cmd-shift-r` opens the Changes panel for the focused pane's
  repository. With an agent focused, `cmd-shift-t` opens its Tinkery setup
  dialog. On Herdr builds with `window.open_or_focus`, pressing it again
  brings that agent’s open dialog forward with your checkout edits intact.
  Stock Herdr 0.1.11 opens a fresh dialog each time. Starting Tinkery takes a
  separate click.
- A top-right sun/moon button switches the Tinkery themes. No theme hotkey.
- `tinkery-pane` (a fork of T3's `t3-pane`): right-click a pane header for
  the native pane menu; hover an agent's header for **Open Tinkery…**.
- `tinkery-companion` starts Tinkery for that agent in the agent's reported
  folder (or an explicit checkout) and places it beside the agent with a
  native, draggable split. It never discovers repositories or initializes Git,
  and uses Tinkery's saved model and call allowance. A Tinkery pane's header
  offers **Change checkout…**; its close button hides it and keeps it running.
- The upstream `herdr-t3` layout stays untouched and remains available.
- Portable macOS keybindings; machine preferences are missing-key defaults only.

The font preference references Paper Mono, but no font binaries are distributed.
Install that font separately or select a bundled font in Herdr. The SVG layout
preview is the unchanged upstream schematic, not a live-session screenshot.
The workbench/decision-queue idea is not implemented.

## Dependency boundary

Tested with Herdr Desktop 0.1.11. Desktop supplies `gpui-kit`, the `herdr` API,
shipped mods/icons, and generated type files. They are not vendored here.
Herdr and Node.js must already be installed; scripts install no system packages.
`make verify` also needs Tinkery: a checkout (for its terminal test helpers)
and the installed `tinkery` executable.

`upstream.lock.json` pins Herdr T3 to an exact Git commit and SHA-256 for every
installed upstream file. `t3-pane`, `t3-agents` and `t3-inbox` are copied as
`tinkery-pane`, `tinkery-agent-list` and `tinkery-inbox`; the menu also copies
T3's status-tree helper. Merge upstream changes into these copies by hand when updating the lock.
Updates require a reviewed lock change and compatibility tests. New upstream
layout features do not automatically merge into the personal layout.

To prepare the dependency separately (network access is explicit):

```sh
git clone https://github.com/JinJieBeWater/herdr-t3.git /path/to/herdr-t3
git -C /path/to/herdr-t3 checkout --detach 287f0f3653daae33f39f24daaee3d6b556094610
```

## Plan first; deploy only when approved

Start Herdr Desktop once so it writes its shipped files. Then, from this checkout:

```sh
python3 scripts/config.py plan --upstream /path/to/herdr-t3
```

The default target is `$HERDR_APP_HOME` or `~/.config/herdr-app`. `--target`
selects another existing Herdr home. Planning and checking perform no writes,
network requests, window commands, or terminal operations.

After reviewing the plan and explicitly approving live changes:

```sh
python3 scripts/config.py apply --upstream /path/to/herdr-t3
python3 scripts/config.py check --upstream /path/to/herdr-t3
herdr-app check "$HOME/.config/herdr-app/mods/tinkery-theme"
herdr-app do layout.switch --name tinkery-t3
herdr-app status
```

Use your selected Herdr home instead of the default path when it differs.
`apply` never activates a layout, stops sessions, or runs upstream code. Validate
all installed `mods/t3-*` with `herdr-app check` before switching, then inspect
a screenshot. A running window is not proof a modified file loaded successfully.

Deployment rules:

- Personal files and locked upstream files are managed. Existing identical
  files can be adopted; different unowned files fail instead of being overwritten.
- A machine-local `.tink-herdr-config/receipt.json` records deployed hashes and
  owned keybindings. Later clean source changes can be applied; local drift fails.
- Keybindings merge by section/key, preserving unrelated bindings. Conflicting
  unowned bindings fail. The old `tinkery-status` theme shortcut is not shipped.
- `settings.defaults.json` fills only missing top-level preferences. Existing
  preferences, including appearance selected by the button, remain local.
  Changing defaults does not force existing machines back to those defaults.
- Symlink sources/destinations and path traversal fail. Retiring a managed file
  or binding requires an explicit migration; nothing is automatically deleted.
- Replaced files are backed up inside the private target's
  `.tink-herdr-config/backups/`. Individual replacements are atomic; the whole
  deployment is not a transaction. A write failure can require inspecting the
  plan and restoring selected backups. No force or automatic rollback command.

Keep source changes in this checkout. Review live differences explicitly;
never copy the whole runtime directory back into Git. `check` reports drift,
not app health. The settings file is deliberately not byte-for-byte managed.
There is no technical lock against a future human overwriting personal files.

## Verification and public-file review

```sh
make test
make audit
make verify UPSTREAM_DIR=/path/to/herdr-t3 \
  TINKERY_DIR=/path/to/tinkery TINKERY_BIN=/path/to/tinkery-executable
```

The integration verifier uses a temporary home and reads only shipped files
from an existing installation (`HERDR_FIXTURE_HOME` selects it). It never opens
a new window or writes live configuration. It tests offline deployment,
idempotence, every T3 and Tinkery mod, upstream regression tests, the theme
button, the pane header, the Tinkery companion, and both personal sidebar menus.
`tests/tinkery_terminal.py` then drives the real `tinkery` program in a
terminal at 100x30 and 80x24 with a temporary home and zero model budget:
practice Think, empty Shape, resizing to 64x24 and back. Fake provider programs
fail the test if called. It reads no live Herdr state; on failure it keeps its
temporary folder and prints its path. No external models, credentials, npm dependencies, static typechecker or formatter
are required. Herdr's native mod checker validates the installed JavaScript API.

`publication.json` is the exact candidate public-file allowlist. The audit fails
on extra/missing files, symlinks, binaries, recognizable credentials or personal
home paths; it prints paths and hashes, never matching secret values. `.gitignore`
is defense in depth, not an export rule. A pattern scan is not a guarantee that
no secret exists. Review the allowlist and content again immediately before
staging, creating a remote, or pushing. Those actions need separate approval.

Not included: sessions, terminal text, screenshots, machine/SSH configuration,
credentials, runtime views, settled/pinned state, telemetry, backups, generated
Herdr guides/types, installed Pi code, old custom layouts/mods, or font files.
Normal Git commit metadata is also public; use a reviewed author identity.
No CI workflow or automatic publication/deployment process is configured.

## License

Apache-2.0; see `LICENSE`. Upstream attribution is retained in `NOTICE` and
`LICENSES/herdr-t3-Apache-2.0.txt`.
