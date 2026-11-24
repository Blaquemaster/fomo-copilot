# Shadow isolation

Do not apply `infra/db/shadow-roles.sql` until the owner says so. Application startup does not run it. The role SQL in pull request 41 stays unapplied as well.

The shadow process is off unless `SHADOW_ENABLED` is exactly `true`. Outcome quotes are executed by `apps/screener/src/outcomeWorker.ts`, not by the shadow runner. Starting the runner while `OUTCOMES_ENABLED` is not exactly `true` stops with `outcome_worker_required` and does not report a pass. The runner does not get a Telegram token of its own in this plan, and it must not write `phasec_position`, `phasec_alert`, or `autobuy_intent`. An acceptance report with no recall run and no observations is `NOT_RUNNING` or `INSUFFICIENT_EVIDENCE`, not a pass.

Two ways to run it, neither of which is turned on here:

1. The `fomo_shadow` role on the existing database. It can read the ingest tables and write only the research tables named in the SQL file.
2. An isolated database restored from a copy the owner approved. The shadow process points at that database. It never points at the production writer role.

Reverting the deploy workflow is not a safe way to stop services. The process files themselves exit unless their flag is exactly `true`. Rolling back to an image from before those checks would remove that protection. Do not do that. Leave the flags unset instead.

A failed deploy does not start the shadow, the outcome worker, the screener, or the alerter. Those are on profiles that a normal `up` does not include.
