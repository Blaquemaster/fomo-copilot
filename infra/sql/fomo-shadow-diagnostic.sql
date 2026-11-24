-- Approved diagnostic role. Apply with psql after the schema exists.
--   psql -v ON_ERROR_STOP=1 -d fomo -f infra/sql/fomo-shadow-diagnostic.sql
-- Idempotent. The password is set out of band, not in this file.
-- This is not infra/db/shadow-roles.sql and it is not the PR #41 role migration.
-- Those stay unapplied. This role is not a superuser and cannot write ingest or positions.

SELECT format(
  'CREATE ROLE fomo_shadow LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 8'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fomo_shadow')
\gexec

ALTER ROLE fomo_shadow WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 8;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fomo_shadow', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO fomo_shadow;

CREATE TABLE IF NOT EXISTS diagnostic_spend (
  scope text PRIMARY KEY,
  helius_credits bigint NOT NULL DEFAULT 0,
  jupiter_quotes bigint NOT NULL DEFAULT 0,
  public_rpc_calls bigint NOT NULL DEFAULT 0,
  spent_usd_micros bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS diagnostic_spend_event (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  provider text NOT NULL,
  method text NOT NULL,
  units bigint NOT NULL,
  process_id text NOT NULL,
  accepted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON TABLE ingest_month TO fomo_shadow;
GRANT SELECT, INSERT, UPDATE ON TABLE diagnostic_spend TO fomo_shadow;
GRANT SELECT, INSERT ON TABLE diagnostic_spend_event TO fomo_shadow;
GRANT USAGE, SELECT ON SEQUENCE diagnostic_spend_event_id_seq TO fomo_shadow;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  raw_events, phasec_position, phasec_alert, autobuy_intent
  FROM fomo_shadow;
