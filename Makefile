export PYTHONDONTWRITEBYTECODE := 1

.PHONY: test audit verify

test:
	python3 -m unittest discover -s tests -p 'test_*.py' -v

audit:
	python3 scripts/audit.py

verify: test audit
	@test -n "$(UPSTREAM_DIR)" || (echo 'Set UPSTREAM_DIR to the pinned T3 checkout'; exit 1)
	@test -n "$(TINKERY_DIR)" || (echo 'Set TINKERY_DIR to a Tinkery checkout (for its terminal test helpers)'; exit 1)
	@test -n "$(TINKERY_BIN)" || (echo 'Set TINKERY_BIN to the tinkery executable under test'; exit 1)
	python3 tests/integration.py "$(UPSTREAM_DIR)"
	python3 tests/tinkery_terminal.py "$(TINKERY_DIR)" "$(TINKERY_BIN)"
