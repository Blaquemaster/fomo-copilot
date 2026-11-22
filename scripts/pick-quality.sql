-- Phase C pick-quality check. Read-only. Prints OK/INFO/ALERT lines.
-- psql -X -q -t -A -v hours=6 -f scripts/pick-quality.sql
\set ON_ERROR_STOP 1
with proto as (
  select registered_at,
         coalesce((body::json->>'entriesStartAt')::timestamptz, registered_at) as entries_start,
         fingerprint
  from phasec_protocol where id = 1
),
win as (
  select greatest(now() - make_interval(hours => :hours), (select entries_start from proto)) as since
),
entries as (
  select a.id, a.mint, a.stage, a.arm, a.strength, a.body, a.created_at,
         coalesce(w.tracked_buyers, 0) as buyers,
         case when c.top10_method = 'wallets_v2' then c.top10_pct end as top10,
         c.sniper_pct
  from phasec_alert a
  left join coin_wallet_signal w on w.mint = a.mint
  left join phasec_mint_cache c on c.mint = a.mint
  where a.kind = 'entry' and a.restarted_at is null and a.created_at >= (select since from win)
),
pos as (
  select * from phasec_position where restarted_at is null
)
select line from (
  select 1 as o, 'INFO protocol ' || coalesce((select fingerprint from proto), 'none')
    || ' entries since ' || coalesce(to_char((select entries_start from proto) at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET', '-')
    || ' | window since ' || to_char((select since from win) at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET' as line
  union all
  select 2, 'INFO entries ' || count(*) || ' (strategy ' || count(*) filter (where arm <> 'random_pass')
    || ', control ' || count(*) filter (where arm = 'random_pass') || ')'
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
  select 40, 'ALERT no entries in the last 3 hours while the test is running'
  where (select entries_start from proto) < now() - interval '3 hours'
    and extract(hour from now() at time zone 'America/New_York') between 10 and 22
    and not exists (
      select 1 from phasec_alert where kind = 'entry' and restarted_at is null
        and created_at > now() - interval '3 hours')
) checks order by o, line;
