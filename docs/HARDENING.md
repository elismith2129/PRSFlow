# Hardening checklist — stability & security (started 2026-08-17)

*Eli's standing list ("treat it like a financial institution"). When Eli asks
"what else should we do?" — or a session is wrapping and these are stale —
READ THIS FIRST and surface the open items. Update statuses as things get
done; add new items at the bottom with a date.*

## Open, in priority order

| # | Item | Who | Status |
|---|------|-----|--------|
| 1 | **2FA on the four master accounts** — Supabase, GitHub, Vercel, and the Google account behind the backups. Ten minutes in each service's account settings. The realistic catastrophe is a phished password on one of these, not an app hack. | Eli | ☐ open |
| 2 | **Test the restore, not just the backup.** Take one nightly Drive backup and restore it into a scratch Supabase project to prove the round trip. Never done. One session, ~30 min, then it's *known*. | Claude session + Eli | ☐ open |
| 3 | **Offboarding: billing coordinator leaves end of Aug 2026 week.** Same-day: deactivate her auth account + `user_profiles` row (Claude drafts the one-liner), plus QuickBooks / Ramp / email outside the app. Generalize into a habit for every departure; runners = re-run `create-runners.mjs` (rotates) or `set-one-password.mjs`. | Eli (Claude preps) | ☐ open — **date-critical** |
| 4 | **Audit trail on the work order** ("Activity log on session form and WO" in CLAUDE.md What's Next). The one real money-integrity gap: who changed which rate/payment, when. Prioritize soon after launch. | Claude session | ☐ open |
| 5 | **Dependency updates** — `npm audit --omit=dev` on 2026-08-17 showed 6 high-severity vulns (sharp <0.35 / libvips CVEs, postcss, transitive under next). Low real exposure; do NOT fix the night before launch. Week one after launch: `npm audit fix`, full test pass, ship. | Claude session | ☐ open |
| 6 | **RLS verification snippet** — save the `pg_policies` end-state query (header of `20260814130000_drop_legacy_open_policies.sql`) as a Supabase SQL snippet; run it after ANY future migration touching policies. | Claude session preps, Eli runs | ☐ open |
| 7 | **Habits (no work, just don't ignore):** GitHub "workflow failed" emails = the nightly backup is broken, act same day · glance at app_errors periodically · runner leaves → rotate their password. | Eli | ongoing |

## Deliberately NOT doing (decided 2026-08-17)

Penetration testing, compliance frameworks, paid security monitoring — wrong
scale for a 20-person single-tenant app. What transfers from the
financial-institution mindset is the discipline above, which is mostly free.

## Already in place (the baseline — don't re-propose these)

RLS on every table, verified against the LIVE database (Aug 14) · owner-only
invoice approval enforced by Postgres trigger · totals always computed from
rows, never typed · atomic all-or-nothing saves (`save_work_order_atomic`) ·
`dbResult` red-toast + `app_errors` logging · nightly backup of 42 tables + 4
storage buckets to Drive · service-role key server-only (selftest guards it) ·
no secrets in git (selftest guards it) · per-IP rate limits on public routes ·
private storage buckets with short-lived signed URLs · individual accounts,
role-fenced (runners see only runner surfaces) · append-only legal records
(punches, shift logs, task comments) · `scripts/selftest.mjs` before every
hand-off.
