-- DO NOT APPLY to production.
-- Least-privilege roles for the completed product. Adapted from the
-- unapplied plan in pull request #41, which granted the diagnostic role
-- broad reads. These roles are separate. Passwords are set out of band.
-- The Solana ingestor is the only writer of raw_events.

CREATE ROLE fomo_ingest LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_screen LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_exec LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
CREATE ROLE fomo_report LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';

-- The signer has no database login. It checks a transaction and returns it
-- to fomo_exec. It does not read raw_events.

GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_ingest, fomo_screen, fomo_exec, fomo_report;
GRANT USAGE ON SCHEMA public TO fomo_ingest, fomo_screen, fomo_exec, fomo_report;

GRANT SELECT, INSERT, UPDATE ON TABLE
  raw_events, ingest_status, ingest_checkpoint, ingest_backfill, ingest_coin, pump_coin, pump_trade
  TO fomo_ingest;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  phasec_position, phasec_alert, autobuy_intent
  FROM fomo_ingest;

GRANT SELECT ON TABLE raw_events, pump_trade, wallet_fill, tracked_wallet TO fomo_screen;
GRANT SELECT, INSERT, UPDATE ON TABLE phasec_candidate, phasec_alert TO fomo_screen;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE raw_events, autobuy_intent FROM fomo_screen;

GRANT SELECT ON TABLE phasec_candidate, phasec_position TO fomo_exec;
GRANT SELECT, INSERT, UPDATE ON TABLE
  autobuy_intent, phasec_execution, phasec_quote_attempt, phasec_quote_failure
  TO fomo_exec;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE raw_events FROM fomo_exec;

GRANT SELECT ON TABLE
  raw_events, phasec_candidate, phasec_alert, phasec_position, phasec_execution,
  autobuy_intent, diagnostic_spend, ingest_month
  TO fomo_report;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM fomo_report;
