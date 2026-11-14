-- Verdict query: how many backfills stopped before the slot window was covered.
select count(*)::int as unrecovered_gaps
from ingest_backfill
where unrecovered;

select program_id, reason, gap_from_slot, gap_to_slot, events_recovered, transactions_fetched, observed_at
from ingest_backfill
where unrecovered
order by observed_at desc
limit 50;
