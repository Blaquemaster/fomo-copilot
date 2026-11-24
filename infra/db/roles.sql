-- DO NOT APPLY.
-- This file is a plan. Application startup does not run it. No password belongs in this file.
-- Set passwords out of band. Replace <POSTGRES_DB> with the real database name at apply time.

-- Ingestor: insert-only on raw_events. No update, delete, or truncate of that table.
CREATE ROLE fomo_ingestor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 8 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_ingestor;
GRANT USAGE ON SCHEMA public TO fomo_ingestor;
GRANT INSERT ON TABLE raw_events TO fomo_ingestor;
GRANT USAGE, SELECT ON SEQUENCE raw_events_id_seq TO fomo_ingestor;
-- The ingestor also writes its own checkpoints and derived tables. Those grants are
-- separate from raw_events, which stays insert-only.
GRANT SELECT, INSERT, UPDATE ON TABLE
  ingest_checkpoint, ingest_status, ingest_backfill, ingest_coin, candidates,
  wallet_fill, coin_wallet_signal, pump_trade, pump_coin, tracked_wallet
  TO fomo_ingestor;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE raw_events FROM fomo_ingestor;

-- Screener: read the ingest tables, write the phasec tables.
CREATE ROLE fomo_screener LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 4 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_screener;
GRANT USAGE ON SCHEMA public TO fomo_screener;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fomo_screener;
GRANT INSERT, UPDATE, DELETE ON TABLE
  phasec_position, phasec_alert, phasec_pause, phasec_protocol, phasec_mint_cache,
  phasec_market_snapshot, phasec_weekly, phasec_tier_request
  TO fomo_screener;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE raw_events FROM fomo_screener;

-- Alerter: read alerts and mark them delivered.
CREATE ROLE fomo_alerter LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 2 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_alerter;
GRANT USAGE ON SCHEMA public TO fomo_alerter;
GRANT SELECT ON TABLE phasec_alert, phasec_position TO fomo_alerter;
GRANT UPDATE (delivered_at) ON TABLE phasec_alert TO fomo_alerter;

-- Audit: read-only even if the session tries to turn read-only off.
CREATE ROLE fomo_audit LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  CONNECTION LIMIT 2 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_audit;
GRANT pg_read_all_data TO fomo_audit;
ALTER ROLE fomo_audit SET default_transaction_read_only = on;
ALTER ROLE fomo_audit SET statement_timeout = '120s';
ALTER ROLE fomo_audit SET idle_in_transaction_session_timeout = '60s';

-- Schema changes stay on a migrator role, not on the services.
CREATE ROLE fomo_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 1 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_migrator;
GRANT ALL ON SCHEMA public TO fomo_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO fomo_migrator;
