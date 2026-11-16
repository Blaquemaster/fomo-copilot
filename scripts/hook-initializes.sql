-- Stored transfer-hook initializes per day.
-- The parsed-events scan rejects this instruction name, so the daily check is
-- this count plus the creation-unseen gauge, not a Helius scan.
select date_trunc('day', received_at) as day, count(*)::int as hook_initializes
from raw_events
where event_kind = 'dbc_initialize'
  and payload->>'instructionName' = 'initialize_virtual_pool_with_token2022_transfer_hook'
group by 1
order by 1;
