import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(args, env):
    subprocess.run([str(x) for x in args], cwd=ROOT, env=env, check=True)


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Supply the pinned upstream checkout')
    upstream = Path(sys.argv[1]).absolute()
    shipped = Path(os.environ.get('HERDR_FIXTURE_HOME',
                                 str(Path.home() / '.config/herdr-app')))
    if not shutil.which('herdr-app') or not shutil.which('node'):
        raise SystemExit('herdr-app and Node.js are required for isolated integration checks')
    with tempfile.TemporaryDirectory(prefix='tink-herdr-test-') as temp:
        target = Path(temp) / 'home'
        target.mkdir()
        for name in ('herdr.d.ts', 'gpui-kit.d.ts'):
            shutil.copy2(shipped / name, target / name)
        for name in ('workspace-chrome', 'pane', 'picker', 'menu', 'workspace-status'):
            shutil.copytree(shipped / 'mods' / name, target / 'mods' / name)
        env = dict(os.environ, HERDR_APP_HOME=str(target), PYTHONDONTWRITEBYTECODE='1')
        cli = [sys.executable, ROOT / 'scripts/config.py']
        flags = ['--upstream', upstream, '--target', target]
        run(cli + ['plan'] + flags, env)
        assert not (target / 'layouts/tinkery-t3.json').exists(), 'Plan must not deploy'
        run(cli + ['apply'] + flags, env)
        run(cli + ['check'] + flags, env)
        for mod in sorted((target / 'mods').glob('t3-*')) + [target / 'mods/tinkery-theme']:
            run(['herdr-app', 'check', mod], env)
        run(['node', target / 'mods/t3-spaces/check-sidebar.cjs'], env)
        run(['node', target / 'mods/t3-pane/check-pane.cjs'], env)
        run(['node', ROOT / 'tests/theme.cjs', target], env)
        settings = json.loads((target / 'settings.json').read_text())
        settings['appearance'] = 'dark'
        settings['theme'] = 'tinkery-dark'
        (target / 'settings.json').write_text(json.dumps(settings))
        run(cli + ['check'] + flags, env)
        assert json.loads((target / 'settings.json').read_text())['appearance'] == 'dark'
    print('ok: isolated install, idempotence, eight Herdr mod checks, upstream tests and theme regression tests')


if __name__ == '__main__':
    main()
