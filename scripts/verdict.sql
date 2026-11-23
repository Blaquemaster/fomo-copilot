-- Phase C paper verdict for one protocol fingerprint.
-- Usage:
--   /workspace/fomo-psql.sh -v fingerprint=c1d34366 < scripts/verdict.sql
--   or: psql ... -v fingerprint=c1d34366 -f scripts/verdict.sql
-- Times are displayed in America/New_York. Raw DB numbers, no rounding in
-- the source aggregates. Closed, non-voided rows only (restarted_at is null,
-- status = closed). net_return already includes quoted route fees, price
-- impact, and FOMO fees on the buy and the sell.
--
-- Groups: wallet_backed (wallets_x_screen), screen_only, random_pass, and
-- the raw arm (including second_wave_a / second_wave_b when present).
-- Also splits by would_skip_cost3 and by venue (origin pool_type, else
-- ingest_coin.venue). Bootstrap: 1000 resamples of mean(net) difference vs
-- random_pass, with a normal-approx Welch z for the same contrast.

\set ON_ERROR_STOP on
SET TIME ZONE 'America/New_York';
\pset pager off
\echo
\echo '=== verdict for fingerprint' :fingerprint '==='
\echo

WITH closed AS (
  SELECT
    p.id,
    p.mint,
    p.stage,
    p.arm,
    CASE
      WHEN p.arm = 'wallets_x_screen' THEN 'wallet_backed'
      WHEN p.arm IN ('second_wave_a', 'second_wave_b') THEN p.arm
      WHEN p.arm = 'screen_only' THEN 'screen_only'
      WHEN p.arm = 'random_pass' THEN 'random_pass'
      ELSE p.arm
    END AS grp,
    p.size_pct,
    p.net_return,
    p.size_pct * p.net_return AS bankroll_pct_points,
    p.would_skip_cost3,
    p.round_trip_cost_pct,
    p.opened_at,
    p.closed_at,
    COALESCE(
      (
        SELECT c.pool_type
        FROM candidates c
        WHERE c.mint = p.mint
        ORDER BY c.created_at ASC
        LIMIT 1
      ),
      ic.venue,
      'unknown'
    ) AS venue
  FROM phasec_position p
  LEFT JOIN ingest_coin ic ON ic.mint = p.mint
  WHERE p.status = 'closed'
    AND p.restarted_at IS NULL
    AND p.net_return IS NOT NULL
    AND COALESCE(p.fingerprint, (
      SELECT a.fingerprint
      FROM phasec_alert a
      WHERE a.mint = p.mint
        AND a.stage = p.stage
        AND a.kind = 'entry'
        AND a.created_at = p.alert_at
      LIMIT 1
    )) = :'fingerprint'
),
-- 1) Per group (wallet_backed / screen_only / random_pass / second_wave_*)
group_stats AS (
  SELECT
    c.grp,
    count(*)::int AS n,
    avg(c.net_return) AS mean_net,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY c.net_return) AS median_net,
    sum(c.bankroll_pct_points) AS bankroll_pct_points,
    avg((c.net_return > 0)::int) AS win_rate,
    (
      SELECT sum(x.bankroll_pct_points)
      FROM closed x
      WHERE x.grp = c.grp
        AND x.id <> (
          SELECT y.id FROM closed y
          WHERE y.grp = c.grp
          ORDER BY y.net_return DESC, y.id
          LIMIT 1
        )
    ) AS bankroll_ex_best,
    (
      SELECT coalesce(max(dd.peak - dd.cum), 0)
      FROM (
        SELECT
          running.cum,
          max(running.cum) OVER (ORDER BY running.closed_at, running.id) AS peak
        FROM (
          SELECT
            id,
            closed_at,
            sum(bankroll_pct_points) OVER (ORDER BY closed_at, id) AS cum
          FROM closed
          WHERE grp = c.grp
        ) running
      ) dd
    ) AS max_drawdown_bankroll_points
  FROM closed c
  GROUP BY c.grp
)
SELECT 'by_group' AS slice, * FROM group_stats ORDER BY grp;

\echo
\echo '=== by group and would_skip_cost3 ==='

WITH closed AS (
  SELECT
    p.id,
    p.arm,
    CASE
      WHEN p.arm = 'wallets_x_screen' THEN 'wallet_backed'
      WHEN p.arm IN ('second_wave_a', 'second_wave_b') THEN p.arm
      WHEN p.arm = 'screen_only' THEN 'screen_only'
      WHEN p.arm = 'random_pass' THEN 'random_pass'
      ELSE p.arm
    END AS grp,
    p.net_return,
    p.size_pct * p.net_return AS bankroll_pct_points,
    p.would_skip_cost3,
    p.closed_at
  FROM phasec_position p
  WHERE p.status = 'closed'
    AND p.restarted_at IS NULL
    AND p.net_return IS NOT NULL
    AND COALESCE(p.fingerprint, (
      SELECT a.fingerprint
      FROM phasec_alert a
      WHERE a.mint = p.mint AND a.stage = p.stage AND a.kind = 'entry' AND a.created_at = p.alert_at
      LIMIT 1
    )) = :'fingerprint'
)
SELECT
  grp,
  would_skip_cost3,
  count(*)::int AS n,
  avg(net_return) AS mean_net,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY net_return) AS median_net,
  sum(bankroll_pct_points) AS bankroll_pct_points,
  avg((net_return > 0)::int) AS win_rate
FROM closed
GROUP BY grp, would_skip_cost3
ORDER BY grp, would_skip_cost3 NULLS FIRST;

\echo
\echo '=== by group and venue ==='

WITH closed AS (
  SELECT
    p.id,
    CASE
      WHEN p.arm = 'wallets_x_screen' THEN 'wallet_backed'
      WHEN p.arm IN ('second_wave_a', 'second_wave_b') THEN p.arm
      WHEN p.arm = 'screen_only' THEN 'screen_only'
      WHEN p.arm = 'random_pass' THEN 'random_pass'
      ELSE p.arm
    END AS grp,
    p.net_return,
    p.size_pct * p.net_return AS bankroll_pct_points,
    COALESCE(
      (SELECT c.pool_type FROM candidates c WHERE c.mint = p.mint ORDER BY c.created_at ASC LIMIT 1),
      ic.venue,
      'unknown'
    ) AS venue
  FROM phasec_position p
  LEFT JOIN ingest_coin ic ON ic.mint = p.mint
  WHERE p.status = 'closed'
    AND p.restarted_at IS NULL
    AND p.net_return IS NOT NULL
    AND COALESCE(p.fingerprint, (
      SELECT a.fingerprint
      FROM phasec_alert a
      WHERE a.mint = p.mint AND a.stage = p.stage AND a.kind = 'entry' AND a.created_at = p.alert_at
      LIMIT 1
    )) = :'fingerprint'
)
SELECT
  grp,
  venue,
  count(*)::int AS n,
  avg(net_return) AS mean_net,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY net_return) AS median_net,
  sum(bankroll_pct_points) AS bankroll_pct_points,
  avg((net_return > 0)::int) AS win_rate
FROM closed
GROUP BY grp, venue
ORDER BY grp, venue;

\echo
\echo '=== group vs random_pass: Welch z and 1000-draw bootstrap of mean net difference ==='
\echo 'diff = mean(group) - mean(random_pass). p_boot_le0 is the share of bootstrap diffs <= 0'
\echo '(one-sided: group no better than random). ci95 from bootstrap percentiles.'

WITH closed AS (
  SELECT
    p.id,
    CASE
      WHEN p.arm = 'wallets_x_screen' THEN 'wallet_backed'
      WHEN p.arm IN ('second_wave_a', 'second_wave_b') THEN p.arm
      WHEN p.arm = 'screen_only' THEN 'screen_only'
      WHEN p.arm = 'random_pass' THEN 'random_pass'
      ELSE p.arm
    END AS grp,
    p.net_return
  FROM phasec_position p
  WHERE p.status = 'closed'
    AND p.restarted_at IS NULL
    AND p.net_return IS NOT NULL
    AND COALESCE(p.fingerprint, (
      SELECT a.fingerprint
      FROM phasec_alert a
      WHERE a.mint = p.mint AND a.stage = p.stage AND a.kind = 'entry' AND a.created_at = p.alert_at
      LIMIT 1
    )) = :'fingerprint'
),
random_arm AS (
  SELECT net_return FROM closed WHERE grp = 'random_pass'
),
grp_list AS (
  SELECT DISTINCT grp FROM closed WHERE grp <> 'random_pass'
),
welch AS (
  SELECT
    g.grp,
    (SELECT count(*) FROM closed c WHERE c.grp = g.grp) AS n_g,
    (SELECT count(*) FROM random_arm) AS n_r,
    (SELECT avg(net_return) FROM closed c WHERE c.grp = g.grp) AS mean_g,
    (SELECT avg(net_return) FROM random_arm) AS mean_r,
    (SELECT coalesce(var_samp(net_return), 0) FROM closed c WHERE c.grp = g.grp) AS var_g,
    (SELECT coalesce(var_samp(net_return), 0) FROM random_arm) AS var_r
  FROM grp_list g
),
welch_z AS (
  SELECT
    grp,
    n_g,
    n_r,
    mean_g,
    mean_r,
    mean_g - mean_r AS mean_diff,
    CASE
      WHEN n_g > 0 AND n_r > 0 AND (var_g / nullif(n_g, 0) + var_r / nullif(n_r, 0)) > 0
      THEN (mean_g - mean_r) / sqrt(var_g / n_g + var_r / n_r)
      ELSE null
    END AS welch_z
  FROM welch
),
-- 1000 bootstrap diffs: resample each arm with replacement to its own n
boot AS (
  SELECT
    w.grp,
    s.iter,
    (
      SELECT avg(x.net)
      FROM (
        SELECT r.net_return AS net
        FROM generate_series(1, w.n_g) i
        JOIN LATERAL (
          SELECT c.net_return
          FROM closed c
          WHERE c.grp = w.grp
          OFFSET floor(random() * w.n_g)::int
          LIMIT 1
        ) r ON true
      ) x
    )
    -
    (
      SELECT avg(x.net)
      FROM (
        SELECT r.net_return AS net
        FROM generate_series(1, w.n_r) i
        JOIN LATERAL (
          SELECT ra.net_return
          FROM random_arm ra
          OFFSET floor(random() * w.n_r)::int
          LIMIT 1
        ) r ON true
      ) x
    ) AS diff
  FROM welch_z w
  CROSS JOIN generate_series(1, 1000) AS s(iter)
  WHERE w.n_g > 0 AND w.n_r > 0
)
SELECT
  z.grp,
  z.n_g,
  z.n_r,
  z.mean_g,
  z.mean_r,
  z.mean_diff,
  z.welch_z,
  (SELECT avg(b.diff) FROM boot b WHERE b.grp = z.grp) AS boot_mean_diff,
  (SELECT percentile_cont(0.025) WITHIN GROUP (ORDER BY b.diff) FROM boot b WHERE b.grp = z.grp) AS boot_ci95_low,
  (SELECT percentile_cont(0.975) WITHIN GROUP (ORDER BY b.diff) FROM boot b WHERE b.grp = z.grp) AS boot_ci95_high,
  (SELECT avg((b.diff <= 0)::int) FROM boot b WHERE b.grp = z.grp) AS p_boot_le0
FROM welch_z z
ORDER BY z.grp;

\echo
\echo '=== protocol row ==='
SELECT fingerprint, registered_at AT TIME ZONE 'America/New_York' AS registered_et, body
FROM phasec_protocol
WHERE fingerprint = :'fingerprint';
