-- Pass criteria for the queue and recall soak.
-- Zero dropped transaction frames, handler time, queue depth, slot gaps,
-- the shadow-counter rate, audit coverage, and creation-unseen.

select
  coalesce(sum(received), 0) as tx_received,
  coalesce(sum(dropped) filter (where drop_reason = 'queue_overflow'), 0) as tx_queue_drops,
  coalesce(sum(dropped) filter (where drop_reason = 'oversize'), 0) as tx_oversize_drops
from ingest_frame_hourly
where kind = 'tx';

select
  coalesce(max(max_queue_depth), 0) as max_queue_depth,
  coalesce(max(max_handle_ms), 0) as max_handle_ms,
  coalesce(max(p99_handle_ms), 0) as p99_handle_ms,
  coalesce(sum(slots_seen), 0) as slots_seen,
  coalesce(sum(slot_gaps), 0) as slot_gaps,
  coalesce(sum(shadow_dropped), 0) as shadow_dropped
from ingest_frame_hourly
where kind = 'meta';

select
  case
    when coalesce(sum(received) filter (where kind = 'tx'), 0) = 0 then 0
    else round(
      100.0 * coalesce(sum(shadow_dropped) filter (where kind = 'meta'), 0)
      / sum(received) filter (where kind = 'tx'),
      3
    )
  end as shadow_drop_pct_of_tx
from ingest_frame_hourly;

select
  count(*) as audit_windows,
  count(*) filter (where errored) as errored_windows,
  count(*) filter (where skipped) as skipped_windows,
  count(*) filter (where incomplete and not errored and not skipped) as incomplete_windows,
  count(*) filter (where incomplete = false and errored = false and skipped = false and missed = 0) as clean_windows,
  coalesce(sum(expected) filter (where incomplete = false and errored = false and skipped = false), 0) as expected_events,
  coalesce(sum(missed) filter (where incomplete = false and errored = false and skipped = false), 0) as misses,
  coalesce(sum(recovered) filter (where incomplete = false and errored = false and skipped = false), 0) as recovered,
  coalesce(sum(credits), 0) as credits
from ingest_recall_audit
where ran_at >= now() - interval '7 days';

-- Pump graduations with no create, at or after this venue's coverage slot.
select count(*)::int as creation_unseen
from raw_events later
where later.event_kind = 'pump_migrate'
  and later.mint is not null
  and later.slot >= coalesce((select coverage_slot from ingest_status where id = 1), 0)
  and not exists (
    select 1 from raw_events init
    where init.mint = later.mint
      and init.event_kind in ('pump_create', 'pump_create_v2')
  );
