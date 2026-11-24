-- DO NOT APPLY.
-- Shadow research role. Not applied by startup, deploy, or this repository.
-- It is not a superuser. It cannot write positions, alerts, or trade intents.
-- Passwords are set out of band. Replace <POSTGRES_DB> at apply time.
-- The alternative is an isolated database restored from an approved copy.
-- That copy is not made by this file.

CREATE ROLE fomo_shadow LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 2 PASSWORD '<set out of band>';
GRANT CONNECT ON DATABASE <POSTGRES_DB> TO fomo_shadow;
GRANT USAGE ON SCHEMA public TO fomo_shadow;

GRANT SELECT ON TABLE
  raw_events, candidates, wallet_fill, tracked_wallet, ingest_backfill, ingest_coin,
  autobuy_intent, phasec_position, phasec_alert
  TO fomo_shadow;

GRANT SELECT, INSERT, UPDATE ON TABLE
  phasec_candidate, phasec_execution, phasec_observation, phasec_quote_attempt,
  phasec_wallet_list_version, phasec_config_history
  TO fomo_shadow;

-- After diagnostic_spend and diagnostic_spend_event exist, the same role also needs:
--   GRANT SELECT ON TABLE ingest_month TO fomo_shadow;
--   GRANT SELECT, INSERT, UPDATE ON TABLE diagnostic_spend TO fomo_shadow;
--   GRANT SELECT, INSERT ON TABLE diagnostic_spend_event TO fomo_shadow;
--   GRANT USAGE, SELECT ON SEQUENCE diagnostic_spend_event_id_seq TO fomo_shadow;
-- Those tables are not created here. This file stays unapplied.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  phasec_position, phasec_alert, autobuy_intent, raw_events
  FROM fomo_shadow;
