export PYTHONDONTWRITEBYTECODE := 1

.PHONY: test audit verify

test:
	python3 -m unittest discover -s tests -p 'test_*.py' -v

audit:
	python3 scripts/audit.py

verify: test audit
	@test -n "$(UPSTREAM_DIR)" || (echo 'Set UPSTREAM_DIR to the pinned T3 checkout'; exit 1)
	python3 tests/integration.py "$(UPSTREAM_DIR)"
