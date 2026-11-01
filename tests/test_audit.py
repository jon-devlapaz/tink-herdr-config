import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_audit', ROOT / 'scripts/audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'publication.json').write_text(json.dumps({'files': ['publication.json', 'safe.txt']}))
        (self.root / 'safe.txt').write_text('Public theme colors\n')

    def test_allowlisted_files_pass(self):
        report, findings = audit.audit(self.root)
        self.assertEqual(findings, [])
        self.assertEqual({x['path'] for x in report}, {'publication.json', 'safe.txt'})

    def test_unexpected_runtime_file_fails_even_if_gitignored(self):
        (self.root / 'view.json').write_text('{}')
        self.assertTrue(any('not on publication allowlist' in x for x in audit.audit(self.root)[1]))

    def test_missing_file_fails(self):
        (self.root / 'safe.txt').unlink()
        self.assertTrue(any('missing' in x for x in audit.audit(self.root)[1]))

    def test_synthetic_credential_is_detected_without_echoing_value(self):
        token = 'ghp_' + 'a' * 36
        (self.root / 'safe.txt').write_text(token)
        findings = audit.audit(self.root)[1]
        self.assertTrue(any('GitHub credential' in x for x in findings))
        self.assertNotIn(token, str(findings))

    def test_symlink_is_refused(self):
        (self.root / 'linked.txt').symlink_to(self.root / 'safe.txt')
        self.assertTrue(any('symlink' in x for x in audit.audit(self.root)[1]))

    def test_private_home_path_is_detected(self):
        (self.root / 'safe.txt').write_text('/' + 'Users' + '/private-person/settings.json')
        self.assertTrue(any('private home path' in x for x in audit.audit(self.root)[1]))


if __name__ == '__main__':
    unittest.main()
