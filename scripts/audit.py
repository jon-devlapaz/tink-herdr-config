import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'private home path': r'/(?:Users|home)/[^/\s\"\']+/',
    'private key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'GitHub credential': r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})',
    'cloud credential': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'provider credential': r'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}',
    'Slack credential': r'\bxox[baprs]-[A-Za-z0-9-]{20,}',
    'authenticated URL': r'https?://[^\s/:]+:[^\s/@]+@',
    'JWT': r'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',
}


def audit(root):
    manifest = json.loads((root / 'publication.json').read_text())
    allowed = manifest['files']
    if len(set(allowed)) != len(allowed):
        raise ValueError('Duplicate publication path')
    actual = set()
    findings = []
    report = []
    for p in root.rglob('*'):
        relative = p.relative_to(root)
        if '.git' in relative.parts or '__pycache__' in relative.parts:
            continue
        name = relative.as_posix()
        if p.is_symlink():
            findings.append(f'{name}: symlink is not publishable')
            continue
        if not p.is_file():
            continue
        actual.add(name)
        data = p.read_bytes()
        try:
            content = data.decode('utf-8')
        except UnicodeDecodeError:
            findings.append(f'{name}: unexpected binary file')
            continue
        for label, pattern in PATTERNS.items():
            for match in re.finditer(pattern, content):
                line = content.count('\n', 0, match.start()) + 1
                findings.append(f'{name}:{line}: {label}')
        report.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    for name in sorted(actual - set(allowed)):
        findings.append(f'{name}: not on publication allowlist')
    for name in sorted(set(allowed) - actual):
        findings.append(f'{name}: publication file is missing')
    return sorted(report, key=lambda x: x['path']), findings


def main():
    report, findings = audit(ROOT)
    tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    allowed = {row['path'] for row in report}
    for name in filter(None, tracked):
        if name not in allowed:
            findings.append(f'{name}: tracked file outside publication allowlist')
    print(json.dumps({'files': report, 'findings': findings,
                      'scope': 'Exact current working-tree allowlist and pattern scan; not proof that no secrets exist.'},
                     indent=2))
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
