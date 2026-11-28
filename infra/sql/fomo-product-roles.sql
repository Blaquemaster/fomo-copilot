-- DO NOT APPLY to production.
-- Runtime roles do not own tables and cannot grant to themselves.
-- Permissions are named per table. Append-only tables reject update and delete.
-- The signer has no database login.

CREATE ROLE fomo_ingest LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_screen LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_exec LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_report LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';

REVOKE CREATE ON SCHEMA public FROM fomo_ingest, fomo_screen, fomo_exec, fomo_report;
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_ingest, fomo_screen, fomo_exec, fomo_report;
GRANT USAGE ON SCHEMA public TO fomo_ingest, fomo_screen, fomo_exec, fomo_report;

GRANT SELECT, INSERT ON TABLE raw_events TO fomo_ingest;
GRANT SELECT, INSERT, UPDATE ON TABLE ingest_status, ingest_checkpoint, ingest_backfill TO fomo_ingest;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE raw_events FROM fomo_ingest;

GRANT SELECT ON TABLE raw_events, pump_trade, wallet_fill, tracked_wallet TO fomo_screen;
GRANT SELECT, INSERT ON TABLE phasec_candidate, phasec_alert TO fomo_screen;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE raw_events FROM fomo_screen;

GRANT SELECT ON TABLE phasec_candidate, phasec_position TO fomo_exec;
GRANT INSERT ON TABLE autobuy_intent, phasec_execution, phasec_quote_attempt, phasec_quote_failure TO fomo_exec;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  autobuy_intent, phasec_execution, phasec_quote_attempt, phasec_quote_failure
  FROM fomo_exec;

GRANT SELECT ON TABLE
  raw_events, phasec_candidate, phasec_alert, phasec_position, phasec_execution,
  autobuy_intent, diagnostic_spend, ingest_month,
  owner_service, owner_feed, owner_position, wallet_measure, wallet_movement,
  wallet_evidence_report, wallet_shared_funding, workflow_step, completion_decision,
  cash_entry
  TO fomo_report;

GRANT INSERT ON TABLE wallet_measure, wallet_movement, wallet_evidence_report, wallet_shared_funding
  TO fomo_ingest;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  wallet_measure, wallet_movement, wallet_evidence_report, wallet_shared_funding
  FROM fomo_ingest;
