-- Migrations or curve completions with no initialize row for the same mint.
select later.event_kind, later.signature, later.slot, later.mint, later.source
from raw_events later
where later.event_kind in ('dbc_migration_damm_v2', 'dbc_curve_complete')
  and later.mint is not null
  and not exists (
    select 1 from raw_events init
    where init.mint = later.mint and init.event_kind = 'dbc_initialize'
  )
order by later.slot desc
limit 50;
