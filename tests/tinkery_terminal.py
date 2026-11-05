"""Tinkery's own screens in a real terminal, on TEST data only.

Usage: python3 tests/tinkery_terminal.py TINKERY_DIR TINKERY_BIN
TINKERY_DIR is a Tinkery checkout (for its tests/terminal_process.py helpers);
TINKERY_BIN is the tinkery executable under test. Every run uses a temporary
home with no reachable provider: PATH holds only system folders plus fake
provider programs that fail the test if called, TINKERY_NODE points nowhere,
and --shape-budget 0 is a second layer. It reads no live Herdr state and
writes nothing outside its temporary folder.
"""
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time

sys.dont_write_bytecode = True


def flat(text):
    return ' '.join(text.split())


def shape_view(text):
    message = 'No goals are waiting for a seed. Confirm a goal in think, then shape it here.'
    rows = [row.strip() for row in text.splitlines() if row.strip()]
    return ('tinkery › shape' in flat(text) and message in flat(text)
            and bool(rows) and rows[-1] == 'esc back')


def check_shape_view_rejects(frame):
    assert shape_view(frame), 'the narrow Shape view must pass'
    assert not shape_view(frame.replace('esc back', '')), 'a missing exit must fail'
    assert not shape_view(frame.replace('then shape it here.', '')), 'a clipped message must fail'
    assert not shape_view(frame.replace('tinkery › shape', 'tinkery › think')), 'the wrong phase must fail'


def run(binary, width, height, base):
    from terminal_process import TerminalProcess, wait_output

    root = Path(tempfile.mkdtemp(prefix=f'TEST-{width}x{height}-', dir=base))
    home = root / 'TEST-HOME'
    checkout = root / 'TEST checkout'
    (home / '.config/tinkery').mkdir(parents=True)
    checkout.mkdir()
    model = home / '.config/tinkery/model.json'
    model.write_text(json.dumps({'harness': 'pi', 'model': 'test/never', 'thinking': 'medium', 'calls': 5}))
    saved_model = model.read_bytes()
    invoked = root / 'TEST-provider-invoked'
    guard = root / 'TEST-no-provider'
    guard.write_text(f'#!/bin/sh\nprintf unexpected >> "{invoked}"\nexit 86\n')
    guard.chmod(0o700)
    bin_dir = root / 'TEST-bin'
    bin_dir.mkdir()
    for name in ('pi', 'claude', 'codex', 'node'):
        (bin_dir / name).symlink_to(guard)
    env = {'PATH': f'{bin_dir}:/usr/bin:/bin', 'HOME': str(home), 'TERM': 'xterm-256color', 'NO_COLOR': '1',
           'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'),
           'XDG_CACHE_HOME': str(home / '.cache'), 'PI_CODING_AGENT_DIR': str(home / '.pi/agent'),
           'TINKERY_NODE': '/tinkery-TEST-no-node', 'PYTHONDONTWRITEBYTECODE': '1'}
    args = [str(binary), '--home', '--operator', 'agent', '--shape-budget', '0',
            '--seed-session-root', str(root / 'TEST-sessions'), '--record-root', str(root / 'TEST-records'),
            '--link-root', str(root / 'TEST-links'), '--sdlc-root', str(checkout), '--no-color', '--full-redraw']
    terminal = TerminalProcess(args, cwd=checkout, env=env, width=width, height=height)

    def wait(predicate, description):
        deadline = time.monotonic() + 8

        def consume(chunk):
            terminal.raw.extend(chunk)
            terminal.screen.feed(chunk)
        for returncode in wait_output(terminal.master, terminal.process, consume, deadline):
            if terminal.screen.ready() and predicate(terminal.screen.text()):
                return terminal.screen.text()
            if returncode is not None:
                break
        raise AssertionError(f'{description} ({width}x{height})\n{terminal.screen.text()}')

    def send(keys, predicate, description):
        before = terminal.screen.frames
        os.write(terminal.master, keys)
        return wait(lambda screen: terminal.screen.frames > before and predicate(screen), description)

    def menu(screen):
        return bool(re.search(r'1\s+think', screen)) and bool(re.search(r'3\s+shape', screen))

    try:
        home_menu = wait(menu, 'home menu')
        assert 'practice' in home_menu, 'with no reachable provider, Tinkery must start in practice mode'
        entered = send(b'1', lambda s: "What's on your mind?" in s, 'Think entry')
        assert 'declared: agent' in flat(entered), entered
        words = 'TEST cafe words remain mine.\nOnly TEST data; never launch agents.'
        send(b'\x1b[200~' + words.encode() + b'\x1b[201~', lambda s: 'never launch agents.' in s, 'pasted words')
        send(b'\x1bOQ', lambda s: 'Simulated sensemaking' in flat(s), 'zero-budget simulated reading')
        actions = send(b'\x1bOP', lambda s: 'Close help' in flat(s) or 'F1 close' in flat(s), 'Think actions')
        assert 'Review the goal' not in actions, 'a simulated reading must not offer goal review'
        send(b'\x1b', lambda s: 'Simulated sensemaking' in flat(s), 'close help')
        for _ in range(4):
            if menu(terminal.screen.text()):
                break
            before = terminal.screen.frames
            send(b'\x1b', lambda s: terminal.screen.frames > before, 'leave Think')
            if 'y / n' in terminal.screen.text():
                send(b'y', menu, 'discard the TEST draft')
        assert menu(terminal.screen.text()), terminal.screen.text()
        send(b'3', shape_view, 'empty Shape')
        terminal.resize(64, 24)
        narrow = wait(shape_view, 'Shape at 64x24 keeps its message and exit')
        assert (terminal.screen.width, terminal.screen.height) == (64, 24)
        check_shape_view_rejects(narrow)
        terminal.resize(width, height)
        wait(shape_view, 'Shape after restoring the size')
        assert (terminal.screen.width, terminal.screen.height) == (width, height)
        send(b'\x1b', menu, 'back to home')
        os.write(terminal.master, b'q')
        terminal.process.wait(timeout=5)
        assert terminal.process.returncode == 0, f'tinkery exited with {terminal.process.returncode}'
        assert not invoked.exists(), 'a provider program was invoked'
        assert model.read_bytes() == saved_model, 'saved model settings changed'
        assert not list((root / 'TEST-sessions').rglob('ledger.json')), 'a goal was saved'
        assert not list((root / 'TEST-records').rglob('*.json')), 'a record was written'
        assert not (checkout / '.git').exists(), 'Git was initialized'
    finally:
        (root / 'last-screen.txt').write_text(terminal.screen.text())
        terminal.close()


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: tinkery_terminal.py TINKERY_DIR TINKERY_BIN')
    tinkery_dir = Path(sys.argv[1]).expanduser().absolute()
    binary = Path(sys.argv[2]).expanduser().absolute()
    helpers = tinkery_dir / 'tests'
    if not (helpers / 'terminal_process.py').is_file():
        raise SystemExit(f'TINKERY_DIR has no tests/terminal_process.py: {tinkery_dir}')
    if not (binary.is_file() and os.access(binary, os.X_OK)):
        raise SystemExit(f'TINKERY_BIN is not an executable file: {binary}')
    sys.path.insert(0, str(helpers))
    base = Path(tempfile.mkdtemp(prefix='tinkery-terminal-test-'))
    try:
        for size in ((100, 30), (80, 24)):
            run(binary, *size, base)
    except BaseException:
        print(f'Evidence kept in {base}', file=sys.stderr)
        raise
    shutil.rmtree(base)
    print('ok: Tinkery at 100x30 and 80x24 on TEST data: practice Think stays simulated with no goal review, '
          'empty Shape survives 64x24 and restores, no provider calls, no saved goals or records, no Git init.')


if __name__ == '__main__':
    main()
