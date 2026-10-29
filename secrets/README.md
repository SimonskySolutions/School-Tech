# Local secrets

This folder holds generated development passwords. Every file here except this one is ignored by git.

Generate them with `scripts/dev-secrets.sh`. Never copy production secrets into this folder; production secrets come from the host's secret store (see `docs/operations.md`).
