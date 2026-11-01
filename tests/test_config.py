import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('herdr_config', ROOT / 'scripts/config.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'repo'
        self.upstream = self.base / 'upstream'
        self.target = self.base / 'home'
        self.root.mkdir()
        self.upstream.mkdir()
        self.target.mkdir()
        self.upstream_data = {
            'LICENSE': b'fixture license',
            'layouts/herdr-t3.json': b'{"type":"row"}\n',
            'mods/t3-tabs/main.js': b'fixture upstream mod\n',
        }
        lock = {'schema': 1, 'commit': 'a' * 40, 'files': {}}
        for name, data in self.upstream_data.items():
            self.put(self.upstream, name, data)
            lock['files'][name] = hashlib.sha256(data).hexdigest()
        self.put(self.root, 'upstream.lock.json', config.encode(lock))
        for name in config.LOCAL_FILES:
            self.put(self.root / 'config', name, (ROOT / 'config' / name).read_bytes())
        self.keys = {'global': {'cmd-p': 'mod.open:picker'},
                     'layout:tinkery-t3': {'cmd-shift-b': 't3-chrome.sidebar'}}
        self.put(self.root, 'config/keys.json', config.encode(self.keys))
        self.put(self.root, 'config/settings.defaults.json', config.encode({
            'appearance': 'light', 'theme': 'tinkery-light', 'zoom': 0.9}))
        for name in ('herdr.d.ts', 'gpui-kit.d.ts', 'mods/workspace-chrome/spinner.svg'):
            self.put(self.target, name, b'fixture')
        self.git = patch.object(config.subprocess, 'check_output', return_value='a' * 40 + '\n')
        self.git.start()
        self.addCleanup(self.git.stop)

    def put(self, root, name, data):
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def plan(self):
        return config.plan(self.root, self.upstream, self.target)

    def deploy(self):
        changes, before, conflicts = self.plan()
        self.assertEqual(conflicts, [])
        return config.apply(self.target, changes, before, conflicts)

    def snapshot(self):
        return {str(p.relative_to(self.target)): p.read_bytes()
                for p in self.target.rglob('*') if p.is_file()}

    def test_plan_is_read_only(self):
        old = self.snapshot()
        changes, _, conflicts = self.plan()
        self.assertIn('layouts/tinkery-t3.json', changes)
        self.assertEqual(conflicts, [])
        self.assertEqual(self.snapshot(), old)

    def test_apply_is_idempotent_and_preserves_state(self):
        for name in ('data/pins.json', 'view.json', 'seen.json', 'window.json', 'sessions/sample.jsonl'):
            self.put(self.target, name, b'private fixture')
        old = self.snapshot()
        self.deploy()
        changes, _, conflicts = self.plan()
        self.assertEqual(changes, {})
        self.assertEqual(conflicts, [])
        for name, data in old.items():
            self.assertEqual((self.target / name).read_bytes(), data)
        self.assertEqual((self.target / 'mods/t3-tabs/main.js').read_bytes(),
                         self.upstream_data['mods/t3-tabs/main.js'])

    def test_existing_preferences_and_unrelated_keys_are_preserved(self):
        self.put(self.target, 'settings.json', config.encode({'appearance': 'dark', 'font': 'Local Font'}))
        self.put(self.target, 'keys.json', config.encode({'global': {'cmd-x': 'local.command'},
                                                       'mod:private': {'ctrl-x': 'private.command'}}))
        self.deploy()
        settings = json.loads((self.target / 'settings.json').read_bytes())
        self.assertEqual(settings['appearance'], 'dark')
        self.assertEqual(settings['font'], 'Local Font')
        self.assertEqual(settings['zoom'], 0.9)
        keys = json.loads((self.target / 'keys.json').read_bytes())
        self.assertEqual(keys['global']['cmd-x'], 'local.command')
        self.assertEqual(keys['mod:private'], {'ctrl-x': 'private.command'})
        self.assertEqual(self.plan()[0], {})

    def test_unmanaged_difference_blocks_every_write(self):
        self.put(self.target, 'layouts/tinkery-t3.json', b'local layout')
        old = self.snapshot()
        changes, before, conflicts = self.plan()
        self.assertTrue(conflicts)
        with self.assertRaises(ValueError):
            config.apply(self.target, changes, before, conflicts)
        self.assertEqual(self.snapshot(), old)

    def test_managed_drift_is_not_overwritten(self):
        self.deploy()
        self.put(self.target, 'mods/tinkery-theme/main.js', b'local modification')
        self.assertTrue(self.plan()[2])

    def test_source_change_updates_clean_owned_file_and_backs_it_up(self):
        self.deploy()
        name = 'mods/tinkery-theme/main.js'
        previous = (self.target / name).read_bytes()
        self.put(self.root / 'config', name, previous + b'\n')
        backup = self.deploy()
        self.assertEqual((self.target / backup / name).read_bytes(), previous)
        self.assertEqual((self.target / name).read_bytes(), previous + b'\n')

    def test_conflicting_keybinding_blocks_apply(self):
        self.put(self.target, 'keys.json', config.encode({'global': {'cmd-p': 'local.command'}}))
        self.assertTrue(any('Keybinding conflict' in c for c in self.plan()[2]))

    def test_owned_key_change_applies_but_local_override_conflicts(self):
        self.deploy()
        updated = copy.deepcopy(self.keys)
        updated['global']['cmd-p'] = 'mod.open:other'
        self.put(self.root, 'config/keys.json', config.encode(updated))
        self.deploy()
        keys = json.loads((self.target / 'keys.json').read_bytes())
        keys['global']['cmd-p'] = 'local.command'
        self.put(self.target, 'keys.json', config.encode(keys))
        self.assertTrue(self.plan()[2])

    def test_upstream_revision_or_content_mismatch_fails(self):
        config.subprocess.check_output.return_value = 'b' * 40 + '\n'
        with self.assertRaisesRegex(ValueError, 'revision'):
            self.plan()
        config.subprocess.check_output.return_value = 'a' * 40 + '\n'
        self.put(self.upstream, 'mods/t3-tabs/main.js', b'changed upstream')
        with self.assertRaisesRegex(ValueError, 'differs from lock'):
            self.plan()

    def test_symlink_target_or_parent_is_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (self.target / 'themes').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.plan()
        self.assertEqual(list(outside.iterdir()), [])

    def test_path_traversal_is_refused(self):
        for name in ('../outside', '/absolute', 'mods/../../outside', 'mods\\outside'):
            with self.assertRaises(ValueError):
                config.safe_path(self.target, name)

    def test_race_between_plan_and_apply_is_refused(self):
        changes, before, conflicts = self.plan()
        self.put(self.target, 'keys.json', config.encode({'global': {'cmd-k': 'new.command'}}))
        old = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'changed since planning'):
            config.apply(self.target, changes, before, conflicts)
        self.assertEqual(self.snapshot(), old)

    def test_invalid_json_and_shapes_fail(self):
        for value in (b'[]', b'null', b'{broken', b'{"global":[]}'):
            with self.subTest(value=value):
                self.put(self.target, 'keys.json', value)
                with self.assertRaises((ValueError, TypeError)):
                    self.plan()

    def test_retired_managed_paths_require_explicit_migration(self):
        self.deploy()
        receipt = json.loads((self.target / config.RECEIPT).read_bytes())
        receipt['files']['mods/retired/main.js'] = 'a' * 64
        self.put(self.target, config.RECEIPT, config.encode(receipt))
        self.assertTrue(any('Retired managed file' in c for c in self.plan()[2]))


if __name__ == '__main__':
    unittest.main()
