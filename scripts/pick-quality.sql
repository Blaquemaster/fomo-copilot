-- Phase C pick-quality check. Read-only. Prints OK/INFO/ALERT lines.
-- psql -X -q -t -A -v hours=6 -f scripts/pick-quality.sql
\set ON_ERROR_STOP 1
with proto as (
  select registered_at,
         coalesce((body::json->>'entriesStartAt')::timestamptz, registered_at) as entries_start,
         fingerprint,
         coalesce((body::json->'config'->>'paperWindowDays')::int, 7) as window_days
  from phasec_protocol where id = 1
),
win as (
  select greatest(now() - make_interval(hours => :hours), (select entries_start from proto)) as since
),
tip as (select coalesce(max(slot), 0) as slot from wallet_fill),
rate as (
  select case
    when extract(epoch from max(first_seen_at) - min(first_seen_at)) >= 600
      and max(first_seen_slot) > min(first_seen_slot)
    then (max(first_seen_slot) - min(first_seen_slot))::float
      / extract(epoch from max(first_seen_at) - min(first_seen_at))
    else 4.65 end as per_sec
  from candidates where source = 'stream' and first_seen_at > now() - interval '6 hours'
),
selective as (
  select f.wallet from wallet_fill f, tip, rate
  where f.slot > tip.slot - (rate.per_sec * 86400)::bigint
  group by f.wallet having count(distinct f.mint) <= 40
),
entries as (
  select a.id, a.mint, a.stage, a.arm, a.strength, a.body, a.created_at,
         a.sniper_unmeasured,
         coalesce(w.tracked_buyers, 0) as buyers,
         (select count(*) from (
            select f.wallet from wallet_fill f join selective s on s.wallet = f.wallet
            where f.mint = a.mint group by f.wallet
            having count(*) filter (where f.side in ('buy', 'swap'))
              > count(*) filter (where f.side = 'sell')) h) as selective_holders,
         case when c.top10_method = 'wallets_v3' then c.top10_pct end as top10,
         c.sniper_pct
  from phasec_alert a
  left join coin_wallet_signal w on w.mint = a.mint
  left join phasec_mint_cache c on c.mint = a.mint
  where a.kind = 'entry' and a.restarted_at is null and a.created_at >= (select since from win)
),
pos as (
  select * from phasec_position where restarted_at is null
),
-- ET midnight of the current ET calendar day, for "closes today" and the daily pause.
et_today as (
  select ((now() at time zone 'America/New_York')::date)::timestamp
           at time zone 'America/New_York' as start
),
-- Coins in the check window that a currently-selective tracked wallet still holds.
-- Used to catch a whole venue dying on one screen gate (for example sniper unknown).
signaled as (
  select f.mint, max(c.pool_type) as pool_type
  from wallet_fill f
  join selective s on s.wallet = f.wallet
  join candidates c on c.mint = f.mint
  cross join win
  cross join tip
  cross join rate
  where c.source = 'stream' and c.mint !~* '^0x' and coalesce(c.pool_type, '') <> 'flap'
    and c.first_seen_at >= (select since from win)
    and f.slot > tip.slot - (rate.per_sec * 86400)::bigint
  group by f.mint, f.wallet
  having count(*) filter (where f.side in ('buy', 'swap'))
       > count(*) filter (where f.side = 'sell')
),
signaled_mints as (
  select mint, max(pool_type) as pool_type from signaled group by mint
),
signaled_gated as (
  select s.pool_type,
    case
      when cache.mint_authority_active is true then 'mint authority'
      when cache.freeze_authority_active is true then 'freeze authority'
      when cache.exit_impact_pct is not null and cache.exit_impact_pct > 5 then 'exit impact'
      when cache.top10_method = 'wallets_v3' and cache.top10_pct is not null and cache.top10_pct > 50
        then 'top 10 holders'
      when cache.sniper_pct is not null and cache.sniper_pct > 60 then 'sniper bundle'
      when cache.mint_authority_active is null then 'authority missing'
      when cache.exit_impact_pct is null then 'exit impact missing'
      when cache.top10_method is distinct from 'wallets_v3' or cache.top10_pct is null
        then 'holders missing'
      when cache.sniper_pct is null then 'sniper unknown'
      when cache.curve_liquidity_usd is null then 'liquidity missing'
      else 'pass'
    end as gate
  from signaled_mints s
  left join phasec_mint_cache cache on cache.mint = s.mint
),
venue_block as (
  select pool_type, gate, count(*) as n,
         sum(count(*)) over (partition by pool_type) as venue_n
  from signaled_gated
  group by pool_type, gate
)
select line from (
  select 1 as o, 'INFO protocol ' || coalesce((select fingerprint from proto), 'none')
    || ' entries since ' || coalesce(to_char((select entries_start from proto) at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET', '-')
    || ' | window since ' || to_char((select since from win) at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET' as line
  union all
  select 2, 'INFO entries ' || count(*) || ' (strategy ' || count(*) filter (where arm <> 'random_pass')
    || ', control ' || count(*) filter (where arm = 'random_pass')
    || ', sniper unmeasured ' || count(*) filter (where sniper_unmeasured) || ')'
  from entries
  union all
  select 3, 'INFO positions open ' || count(*) filter (where status = 'open')
    || ', pending ' || count(*) filter (where status = 'pending')
    || ', closed ' || count(*) filter (where status = 'closed')
    || ', unpriced ' || count(*) filter (where status = 'unpriced')
    || ' | strategy net sum (bankroll %) '
    || coalesce(round(sum(size_pct * net_return) filter (where status = 'closed' and arm <> 'random_pass')::numeric, 3)::text, '0')
  from pos where alert_at >= (select entries_start from proto)
  union all
  select 10, 'ALERT no wallet support: trench ' || arm || ' ' || mint || ' strength ' || strength
  from entries where stage = 'trench' and arm <> 'random_pass' and buyers < 1
  union all
  select 14, case when created_at > now() - interval '75 minutes' then 'ALERT' else 'INFO' end
    || ' no selective tracked wallet still holds (flip bots or already sold): ' || arm || ' ' || mint
  from entries where arm = 'wallets_x_screen' and selective_holders < 1
  union all
  select 11, 'ALERT top 10 holders ' || round(top10::numeric, 1) || '% ' || arm || ' ' || mint
  from entries where top10 > 50
  union all
  select 12, 'ALERT legacy top 10 100% in alert body ' || arm || ' ' || mint
  from entries where body like '%top 10 holders 100%'
  union all
  select 13, 'ALERT sniper bundle ' || round(sniper_pct::numeric, 1) || '% ' || arm || ' ' || mint
  from entries where sniper_pct > 60
  union all
  select 20, 'ALERT held past exit: ' || arm || ' ' || mint || ' open since '
    || to_char(opened_at at time zone 'America/New_York', 'HH24:MI') || ' ET ('
    || round(extract(epoch from now() - opened_at) / 60) || ' min)'
  from pos where status = 'open' and opened_at < now() - interval '75 minutes'
  union all
  select 21, 'ALERT pending entry never opened: ' || arm || ' ' || mint || ' due '
    || to_char(entry_after at time zone 'America/New_York', 'HH24:MI') || ' ET'
  from pos where status = 'pending' and entry_after < now() - interval '15 minutes'
  union all
  select 22, 'ALERT strategy open positions ' || count(*) || ' > 5'
  from pos where status in ('open', 'pending') and arm <> 'random_pass'
  having count(*) > 5
  union all
  select 30, case when count(*) >= 5 and count(*) filter (where status = 'unpriced' or exit_reason = 'dead') * 1.0 / count(*) > 0.3
    then 'ALERT quote failures: ' else 'INFO quote failures: ' end
    || count(*) filter (where status = 'unpriced') || ' unpriced, '
    || count(*) filter (where exit_reason = 'dead') || ' dead of ' || count(*) || ' closes in window'
  from pos where closed_at >= (select since from win)
  union all
  select 31, 'ALERT daily loss pause ' || day || ': ' || reason
  from phasec_pause where day = (now() at time zone 'America/New_York')::date
  union all
  select 32, 'ALERT daily loss pause ' || p.day || ' with 0 strategy closes today: ' || p.reason
  from phasec_pause p, et_today
  where p.day = (now() at time zone 'America/New_York')::date
    and not exists (
      select 1 from phasec_position pos2
      where pos2.status = 'closed' and pos2.arm <> 'random_pass' and pos2.restarted_at is null
        and pos2.closed_at >= et_today.start)
  union all
  select 40, 'ALERT no strategy entries in the last 3 hours while the test is running'
  where (select entries_start from proto) < now() - interval '3 hours'
    and not exists (
      select 1 from phasec_alert
      where kind = 'entry' and restarted_at is null and arm <> 'random_pass'
        and created_at > now() - interval '3 hours')
  union all
  select 40, 'ALERT no strategy entries in the last 6 hours while the test is running'
  where (select entries_start from proto) < now() - interval '6 hours'
    and not exists (
      select 1 from phasec_alert
      where kind = 'entry' and restarted_at is null and arm <> 'random_pass'
        and created_at > now() - interval '6 hours')
  union all
  select 50, 'ALERT strategy close net_return <= -0.9 id=' || pos.id::text
    || ' mint=' || pos.mint
    || ' venue=' || coalesce(
         (select ic.venue from ingest_coin ic where ic.mint = pos.mint),
         (select c.pool_type from candidates c where c.mint = pos.mint
          order by c.first_seen_at desc limit 1),
         'unknown')
    || ' stage=' || pos.stage
    || ' size_pct=' || pos.size_pct::text
    || ' net_return=' || pos.net_return::text
    || ' closed_et=' || to_char(pos.closed_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI:SS.MS')
  from phasec_position pos
  where pos.arm <> 'random_pass' and pos.status = 'closed'
    and pos.net_return is not null and pos.net_return <= -0.9
    and pos.closed_at >= (select since from win)
  union all
  select 51, 'ALERT phasec_pause day=' || p.day::text
    || ' paused_et=' || to_char(p.paused_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI:SS.MS')
    || ' reason=' || p.reason
  from phasec_pause p
  where p.paused_at >= (select since from win)
     or p.day >= ((select since from win) at time zone 'America/New_York')::date
  union all
  select 41, 'ALERT no strategy entries in the first 4 hours after the test restart'
  where (select entries_start from proto) <= now() - interval '4 hours'
    and not exists (
      select 1 from phasec_alert
      where kind = 'entry' and restarted_at is null and arm <> 'random_pass'
        and created_at < (select entries_start from proto) + interval '4 hours')
  union all
  select 42, 'ALERT ' || pool_type || ': all ' || venue_n::text
    || ' wallet-signal coins blocked by ' || gate || ' (n=' || n::text || ')'
  from venue_block
  where venue_n >= 5 and n = venue_n and gate <> 'pass'
  union all
  select 43, 'ALERT strategy pace projects '
    || round((count(*)::numeric / greatest(extract(epoch from now() - p.entries_start) / 3600, 0.01))
             * (p.window_days * 24), 0)::text
    || ' alerts by window end, below 100 (have '
    || count(*)::text || ' in '
    || round((extract(epoch from now() - p.entries_start) / 3600)::numeric, 1)::text
    || 'h)'
  from proto p
  left join phasec_alert a
    on a.kind = 'entry' and a.restarted_at is null and a.arm <> 'random_pass'
  where p.entries_start <= now() - interval '12 hours'
  group by p.entries_start, p.window_days
  having (count(*)::numeric / greatest(extract(epoch from now() - p.entries_start) / 3600, 0.01))
           * (p.window_days * 24) < 100
) checks order by o, line;
