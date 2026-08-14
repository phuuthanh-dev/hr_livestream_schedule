# Project Skills

This folder stores Codex skills used by `hr_livestream_schedule`.

## Domain Layout

- `01_recruitment`: candidate intake, audition review, offer recommendation
- `02_live_ops`: schedule normalization, host/support assignment, live-session operations
- `03_contracts`: contract extraction, Drive sync QA, HR file updates
- `04_evaluation`: review/rating workflows, training checklist scoring, post-live grading
- `05_payroll`: salary calculation, commission checks, payout reconciliation
- `99_shared`: shared references, helper scripts, reusable prompts

## Conventions

- Put each skill in `skills/<domain>/<skill-name>/`.
- Keep skill-local files together: `SKILL.md`, optional `references/`, `scripts/`, `agents/`.
- Put cross-domain assets in `99_shared` only when they are reused by more than one skill.
