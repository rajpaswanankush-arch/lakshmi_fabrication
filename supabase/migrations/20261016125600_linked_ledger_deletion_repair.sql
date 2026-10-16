-- Delete a transaction together with dependent reversals, retaining the full
-- transaction family in the audit log. Also repair the specifically reported
-- orphan reversal only when its exact original is present in prior audit data.

create or replace function public.delete_ledger_entry_from_workspace(
  p_entry_id text,
  expected_revision uuid,
  confirmation_text text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.workspace_snapshots%rowtype;
  v_entry jsonb;
  v_deleted_entries jsonb;
  v_delete_ids text[];
  v_event_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_revision uuid;
  v_snapshot jsonb;
  v_audit_entry jsonb;
  v_audit_trail jsonb;
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then raise exception using errcode = '42501', message = 'Owner access required'; end if;
  if confirmation_text is distinct from 'DELETE' then raise exception using errcode = '22023', message = 'Type DELETE to confirm'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then raise exception using errcode = '22023', message = 'Enter a short reason (3 to 300 characters)'; end if;
  select * into v_row from public.workspace_snapshots where user_id = v_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if expected_revision is null or expected_revision <> v_row.revision then return jsonb_build_object('status', 'conflict', 'revision', v_row.revision, 'snapshot', v_row.snapshot); end if;
  select item into v_entry from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'id' = p_entry_id limit 1;
  if v_entry is null then return jsonb_build_object('status', 'not_found', 'revision', v_row.revision, 'snapshot', v_row.snapshot); end if;

  with recursive linked(id) as (
    select p_entry_id
    union
    select item->>'id'
    from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item
    join linked on item->>'reversalOf' = linked.id
  )
  select coalesce(array_agg(id), array[]::text[]) into v_delete_ids from linked;
  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb) into v_deleted_entries
  from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) with ordinality as entries(item, ordinal)
  where item->>'id' = any(v_delete_ids);

  v_audit_entry := jsonb_build_object(
    'id', v_event_id, 'actor', 'Owner', 'action', 'deleted', 'recordType', 'ledger entry',
    'recordId', coalesce(v_entry->>'kind','transaction') || ' · ' || coalesce(v_entry->>'description',''),
    'occurredAt', v_now, 'reason', btrim(p_reason),
    'details', case when cardinality(v_delete_ids) > 1 then (cardinality(v_delete_ids)-1)::text || ' linked reversal record(s) were also removed and retained in audit history.' else null end
  );
  select coalesce(jsonb_agg(recent.event order by recent.ordinality desc), '[]'::jsonb) into v_audit_trail
  from (select event, ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail', '[]'::jsonb) || jsonb_build_array(v_audit_entry)) with ordinality as entries(event, ordinality) order by ordinality desc limit 5000) recent;
  v_snapshot := jsonb_set(v_row.snapshot, '{ledger}', (
    select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) with ordinality as entries(item, ordinal)
    where not (item->>'id' = any(v_delete_ids))
  ));
  v_snapshot := jsonb_set(v_snapshot, '{auditTrail}', v_audit_trail);
  v_revision := gen_random_uuid();
  update public.workspace_snapshots set revision = v_revision, snapshot = v_snapshot, updated_at = v_now where user_id = v_user;
  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values ('workspace', p_entry_id, 'DELETE', jsonb_build_object('ledger_entry', v_entry, 'ledger_entries', v_deleted_entries, 'reason', btrim(p_reason)), v_user, v_event_id)
  on conflict (source_event_id) do nothing;
  return jsonb_build_object('status', 'deleted', 'revision', v_revision, 'snapshot', v_snapshot, 'event_id', v_event_id);
end
$function$;
revoke all on function public.delete_ledger_entry_from_workspace(text, uuid, text, text) from public, anon;
grant execute on function public.delete_ledger_entry_from_workspace(text, uuid, text, text) to authenticated;

-- Repair only the reported SUNDAY pair. The original must be recoverable from
-- the prior owner-deletion audit event, and all still-live linked entries must
-- already be Reversed (so retiring them cannot change financial totals).
do $repair$
declare
  v_row public.workspace_snapshots%rowtype;
  v_reversal jsonb;
  v_original jsonb;
  v_original_actor uuid;
  v_event_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_delete_ids text[];
  v_deleted_entries jsonb;
  v_snapshot jsonb;
  v_audit_entry jsonb;
  v_audit_trail jsonb;
  v_revision uuid;
begin
  select s.* into v_row
  from public.workspace_snapshots s
  where exists (
    select 1 from jsonb_array_elements(coalesce(s.snapshot->'ledger', '[]'::jsonb)) item
    where item->>'kind' = 'Labour payment'
      and item->>'description' = 'Reversal: SUNDAY'
      and item->>'date' = '2026-10-16'
      and item->>'amount' = '500'
      and item->>'workerId' = '0002'
      and item->>'status' = 'Reversed'
      and nullif(item->>'reversalOf', '') is not null
      and not exists (select 1 from jsonb_array_elements(coalesce(s.snapshot->'ledger', '[]'::jsonb)) parent where parent->>'id' = item->>'reversalOf')
  )
  for update;
  if not found then return; end if;

  select item into v_reversal
  from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item
  where item->>'kind' = 'Labour payment'
    and item->>'description' = 'Reversal: SUNDAY'
    and item->>'date' = '2026-10-16'
    and item->>'amount' = '500'
    and item->>'workerId' = '0002'
    and item->>'status' = 'Reversed'
    and nullif(item->>'reversalOf', '') is not null
    and not exists (select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) parent where parent->>'id' = item->>'reversalOf')
  limit 1;

  select a.before_data->'ledger_entry', a.actor_id
  into v_original, v_original_actor
  from public.audit_log a
  where a.table_name = 'workspace'
    and a.record_key = v_reversal->>'reversalOf'
    and a.action = 'DELETE'
    and a.before_data->'ledger_entry'->>'id' = v_reversal->>'reversalOf'
    and a.before_data->'ledger_entry'->>'kind' = 'Labour payment'
    and a.before_data->'ledger_entry'->>'description' = 'SUNDAY'
    and a.before_data->'ledger_entry'->>'date' = '2026-10-01'
    and a.before_data->'ledger_entry'->>'amount' = '500'
    and a.before_data->'ledger_entry'->>'workerId' = '0002'
    and a.before_data->'ledger_entry'->>'status' = 'Reversed'
  order by a.occurred_at desc
  limit 1;
  if v_original is null then raise exception 'Orphan reversal has no exact original in audit history; no production data was changed'; end if;

  with recursive linked(id) as (
    select v_reversal->>'id'
    union
    select item->>'id'
    from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item
    join linked on item->>'reversalOf' = linked.id
  )
  select coalesce(array_agg(id), array[]::text[]) into v_delete_ids from linked;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item
    where item->>'id' = any(v_delete_ids) and item->>'status' is distinct from 'Reversed'
  ) then raise exception 'Orphan reversal family contains an active transaction; no production data was changed'; end if;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_deleted_entries
  from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'id' = any(v_delete_ids);

  v_audit_entry := jsonb_build_object(
    'id', v_event_id, 'actor', 'Owner', 'action', 'deleted', 'recordType', 'ledger entry',
    'recordId', 'Labour payment · SUNDAY', 'occurredAt', v_now,
    'reason', 'Repair orphan reversal using the exact original retained in audit history; complete the requested deletion.',
    'details', 'Both reversed entries are retained in the audit log; no active financial total changed.'
  );
  select coalesce(jsonb_agg(recent.event order by recent.ordinality desc), '[]'::jsonb) into v_audit_trail
  from (select event, ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail', '[]'::jsonb) || jsonb_build_array(v_audit_entry)) with ordinality as entries(event, ordinality) order by ordinality desc limit 5000) recent;
  v_snapshot := jsonb_set(v_row.snapshot, '{ledger}', (
    select coalesce(jsonb_agg(item), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item
    where not (item->>'id' = any(v_delete_ids))
  ));
  v_snapshot := jsonb_set(v_snapshot, '{auditTrail}', v_audit_trail);
  v_revision := gen_random_uuid();
  update public.workspace_snapshots set revision = v_revision, snapshot = v_snapshot, updated_at = v_now where user_id = v_row.user_id;
  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values (
    'workspace', v_original->>'id', 'DELETE',
    jsonb_build_object('ledger_entry', v_original, 'ledger_entries', v_deleted_entries,
      'original_deletion_audit', (select a.before_data from public.audit_log a where a.table_name='workspace' and a.record_key=v_original->>'id' and a.action='DELETE' order by a.occurred_at desc limit 1),
      'recovery_note', 'Original transaction was recovered verbatim from the prior audit event; linked Reversed entries were retired together.',
      'reason', 'Repair orphan reversal after the original audited deletion.'),
    coalesce(v_original_actor, v_row.user_id), v_event_id
  ) on conflict (source_event_id) do nothing;
end
$repair$;

