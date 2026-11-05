# tink-herdr-config

## Ownership and consent

- This checkout owns the personal `tinkery-t3` layout, `tinkery-theme` button,
  Tinkery palettes, declared keybindings, and preference defaults. Herdr Desktop
  owns the window; `hc` owns terminals. Pi configuration is a separate scope.
- Keep source and runtime separate: edit this checkout, review a deployment plan,
  then apply only with explicit permission for the live target. A GitHub update,
  pull, commit, or source edit does not automatically change live Herdr.
- Preserve sessions, machines, unrelated configuration, and runtime state.
  Deployment is not permission to restart the app or stop terminals.
- Stage, commit, or push only when requested. Earlier publication approval is
  not standing permission for later changes. Keep credentials, screenshots,
  terminal contents, machine details, backups, and generated files out of Git.

## Before changing or deploying configuration

1. Read [README.md](README.md) for deployment, verification, and publication rules.
   Inspect `scripts/config.py` before changing its ownership or merge behavior;
   read relevant tests before altering behavior.
2. Resolve the exact T3 dependency from `upstream.lock.json`. Keep upstream mods
   unmodified; personal changes belong in the personal layout or separate mod.
   Keep dependency checkouts outside this repository and out of temporary paths
   when they are needed for ongoing live checks.
3. For live work, read `herdr-app --skill`, then the target home's generated
   `AGENTS.md`; use its generated types when changing mod APIs. Inspect app status
   and run the deployment plan against the explicit target. Stop on conflicts;
   reconcile differences rather than bypassing drift protection.
4. Back up the files being changed before applying. If asked to back up the
   existing setup before adoption, snapshot all existing managed files plus keys
   and settings: the installer only backs up files it actually replaces.
5. After an approved deployment, require an empty `check` result, passing native
   mod checks, and an error-free app status. Inspect a screenshot when the UI
   changes. Preserve the selected layout/focus unless switching is requested.

## Verification and publication

- Run `make verify UPSTREAM_DIR=/path/to/pinned-checkout TINKERY_DIR=/path/to/tinkery
  TINKERY_BIN=/path/to/tinkery-executable`; it includes unit tests, the publication
  audit, isolated deployment/native mod checks, and Tinkery's zero-budget terminal
  test on TEST data. No separate
  static typechecker or formatter is configured. Report unavailable checks.
- Run `herdr-app check` on deployed or temporary mod copies, not `config/mods/`:
  the checker can write `gpui-kit.d.ts` and `jsconfig.json` beside the source.
  Keep those generated helpers outside the checkout and publication allowlist.
- Add intentional public files to `publication.json`; review the exact payload
  and rerun the audit before any authorized commit/push. A clean pattern scan is
  not proof that no secrets exist. Retain Apache-2.0 licensing and attribution.
- Verify regression tests fail when their protection is removed. Keep failed
  deployments/tests visible until resolved; a working old screen is not proof
  that a changed file loaded.

## Known gaps and trade-offs

- **Manual resolution:** there is no auto-pull, auto-deploy, or single update
  command. The pinned dependency path must be supplied explicitly. Treat a
  scheduler or new updater as a separate design and permission decision.
- **Partial authority:** layouts, mods, themes, and declared bindings are managed.
  `settings.defaults.json` fills missing top-level preferences only; existing
  appearance, fonts, and other preferences remain local. Do not claim that all
  desktop settings resolve byte-for-byte from this repo.
- **Manual upstream merges:** a T3 update can change shared mod APIs. Test the
  personal layout against it and deliberately merge desired upstream layout
  changes; pinning does not guarantee future compatibility.
- **Non-transactional deployment:** individual replacements are atomic, but the
  complete deployment is not. Backups are private to the target; there is no
  force, automatic rollback, or automatic removal of retired files/bindings.
- **Tooling burden:** the custom deployment script is maintained code, not an
  upstream Herdr feature. Prefer small, tested changes over extra infrastructure.
- Preserve the old layout's global `cmd-shift-t` binding unless the operator
  asks to remove it. Keep the personal override in `layout:tinkery-t3`.
- **Local receipt:** deployment records file hashes and owned bindings, not the
  source Git revision. Keep revision/provenance in deployment evidence; the
  receipt is drift detection, not a complete release history.
