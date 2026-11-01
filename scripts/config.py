import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILES = (
    'layouts/tinkery-t3.json', 'layouts/tinkery-t3.svg',
    'themes/tinkery-dark.json', 'themes/tinkery-light.json',
    'mods/tinkery-theme/main.js', 'mods/tinkery-theme/look.js',
    'mods/tinkery-theme/mod.json', 'mods/tinkery-theme/sun.svg',
    'mods/tinkery-theme/moon.svg',
)
RECEIPT = '.tink-herdr-config/receipt.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def safe_path(root, relative):
    part = PurePosixPath(relative)
    if not relative or part.is_absolute() or '..' in part.parts or '\\' in relative:
        raise ValueError('Unsafe relative path')
    candidate = root
    if candidate.is_symlink():
        raise ValueError('Symlink root refused')
    for piece in part.parts:
        candidate = candidate / piece
        if candidate.is_symlink():
            raise ValueError(f'Symlink refused: {relative}')
    return candidate


def read(root, relative):
    p = safe_path(root, relative)
    if not p.exists():
        return None
    if not p.is_file():
        raise ValueError(f'Not a regular file: {relative}')
    return p.read_bytes()


def object_json(data, label):
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError(f'{label} must be a JSON object')
    return value


def keymap(value):
    if not isinstance(value, dict):
        raise ValueError('Keys must be a JSON object')
    for section, bindings in value.items():
        if not isinstance(section, str) or not isinstance(bindings, dict):
            raise ValueError('Invalid key section')
        if not all(isinstance(k, str) and isinstance(v, str) for k, v in bindings.items()):
            raise ValueError('Keybindings must be string commands')
    return value


def upstream_files(root, upstream):
    lock = object_json(read(root, 'upstream.lock.json'), 'Upstream lock')
    if lock.get('schema') != 1 or not isinstance(lock.get('files'), dict):
        raise ValueError('Unsupported upstream lock')
    actual = subprocess.check_output(
        ['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != lock['commit']:
        raise ValueError('Upstream revision differs from lock')
    result = {}
    for relative, expected in lock['files'].items():
        if not (relative == 'LICENSE' or relative in ('layouts/herdr-t3.json', 'layouts/herdr-t3.svg')
                or (relative.startswith('mods/t3-') and len(PurePosixPath(relative).parts) >= 3)):
            raise ValueError('Unexpected upstream destination')
        data = read(upstream, relative)
        if data is None or digest(data) != expected:
            raise ValueError(f'Upstream file differs from lock: {relative}')
        target = 'licenses/herdr-t3/LICENSE' if relative == 'LICENSE' else relative
        result[target] = data
    return result


def plan(root, upstream, target):
    if not target.is_dir() or target.is_symlink():
        raise ValueError('Target must be an existing non-symlink Herdr home')
    for required in ('herdr.d.ts', 'gpui-kit.d.ts', 'mods/workspace-chrome/spinner.svg'):
        if read(target, required) is None:
            raise ValueError(f'Start Herdr Desktop once first; missing {required}')
    files = upstream_files(root, upstream)
    for relative in LOCAL_FILES:
        data = read(root / 'config', relative)
        if data is None:
            raise ValueError(f'Missing managed source: {relative}')
        files[relative] = data
    raw_state = read(target, RECEIPT)
    state = object_json(raw_state, 'Receipt') if raw_state else {'schema': 1, 'files': {}, 'keys': {}}
    if state.get('schema') != 1 or not isinstance(state.get('files'), dict):
        raise ValueError('Invalid deployment receipt')
    previous_keys = keymap(state.get('keys', {}))
    conflicts = []
    changes = {}
    before = {}
    for retired in set(state['files']) - set(files):
        conflicts.append(f'Retired managed file needs explicit migration: {retired}')
    for relative, wanted in files.items():
        current = read(target, relative)
        before[relative] = current
        if current == wanted:
            continue
        if current is not None and digest(current) != state['files'].get(relative):
            conflicts.append(f'Unmanaged difference or local drift: {relative}')
        else:
            changes[relative] = wanted
    raw_keys = read(target, 'keys.json')
    merged_keys = keymap(object_json(raw_keys, 'Live keys')) if raw_keys is not None else {}
    wanted_keys = keymap(object_json(read(root / 'config', 'keys.json'), 'Source keys'))
    for section, bindings in previous_keys.items():
        for key in bindings:
            if key not in wanted_keys.get(section, {}):
                conflicts.append(f'Retired keybinding needs explicit migration: {section}/{key}')
    for section, bindings in wanted_keys.items():
        current_section = merged_keys.setdefault(section, {})
        for key, command in bindings.items():
            current = current_section.get(key)
            previous = previous_keys.get(section, {}).get(key)
            if current is not None and current != command and current != previous:
                conflicts.append(f'Keybinding conflict: {section}/{key}')
            else:
                current_section[key] = command
    before['keys.json'] = raw_keys
    if raw_keys is None or json.loads(raw_keys) != merged_keys:
        changes['keys.json'] = encode(merged_keys)
    raw_settings = read(target, 'settings.json')
    settings = object_json(raw_settings, 'Live settings') if raw_settings is not None else {}
    defaults = object_json(read(root / 'config', 'settings.defaults.json'), 'Defaults')
    for key, value in defaults.items():
        settings.setdefault(key, value)
    before['settings.json'] = raw_settings
    if raw_settings is None or json.loads(raw_settings) != settings:
        changes['settings.json'] = encode(settings)
    new_state = {'schema': 1, 'files': {p: digest(data) for p, data in sorted(files.items())},
                 'keys': wanted_keys}
    before[RECEIPT] = raw_state
    if raw_state != encode(new_state):
        changes[RECEIPT] = encode(new_state)
    return changes, before, conflicts


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply(target, changes, before, conflicts):
    if conflicts:
        raise ValueError('Conflicts must be resolved before applying')
    for relative, expected in before.items():
        if read(target, relative) != expected:
            raise ValueError(f'Target changed since planning: {relative}')
    backup = '.tink-herdr-config/backups/' + uuid.uuid4().hex
    for relative in changes:
        old = before[relative]
        if old is not None:
            atomic_write(safe_path(target, backup + '/' + relative), old)
    for relative, data in changes.items():
        if read(target, relative) != before[relative]:
            raise ValueError(f'Target changed during deployment: {relative}')
        atomic_write(safe_path(target, relative), data)
    return backup if any(before[p] is not None for p in changes) else None


def main():
    parser = argparse.ArgumentParser(description='Offline, explicit Herdr configuration deployment')
    parser.add_argument('command', choices=('plan', 'apply', 'check'))
    parser.add_argument('--upstream', type=Path, required=True, help='Checkout at the locked T3 commit')
    parser.add_argument('--target', type=Path,
                        default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))))
    args = parser.parse_args()
    target = args.target.expanduser().absolute()
    upstream = args.upstream.expanduser().absolute()
    try:
        changes, before, conflicts = plan(ROOT, upstream, target)
        result = {'changes': sorted(changes), 'conflicts': conflicts}
        if args.command == 'apply':
            result['backup'] = apply(target, changes, before, conflicts)
        print(json.dumps(result, indent=2))
        return 1 if conflicts or (args.command == 'check' and changes) else 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Configuration error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
