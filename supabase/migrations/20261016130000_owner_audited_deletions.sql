-- Owner requested deletion is revision checked and audit preserving.
drop function if exists public.delete_worker_from_workspace(text, uuid, text);

create or replace function public.delete_worker_from_workspace(
  p_worker_id text,
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
  v_worker jsonb;
  v_attendance jsonb := '[]'::jsonb;
  v_wages jsonb := '[]'::jsonb;
  v_linked_ledger jsonb := '[]'::jsonb;
  v_event_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_revision uuid;
  v_snapshot jsonb;
  v_audit_entry jsonb;
  v_audit_trail jsonb;
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if confirmation_text is distinct from 'DELETE' then
    raise exception using errcode = '22023', message = 'Type DELETE to confirm';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then
    raise exception using errcode = '22023', message = 'Enter a short reason (3 to 300 characters)';
  end if;
  if p_worker_id is null or p_worker_id !~ '^\d{4}$' then
    raise exception using errcode = '22023', message = 'Invalid worker ID';
  end if;
  select * into v_row from public.workspace_snapshots where user_id = v_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if expected_revision is null or expected_revision <> v_row.revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_row.revision, 'snapshot', v_row.snapshot);
  end if;
  select item into v_worker from jsonb_array_elements(coalesce(v_row.snapshot->'workers', '[]'::jsonb)) item where item->>'id' = p_worker_id limit 1;
  if v_worker is null then return jsonb_build_object('status', 'not_found', 'revision', v_row.revision, 'snapshot', v_row.snapshot); end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_attendance from jsonb_array_elements(coalesce(v_row.snapshot->'attendance', '[]'::jsonb)) item where item->>'workerId' = p_worker_id;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_wages from jsonb_array_elements(coalesce(v_row.snapshot->'wageHistory', '[]'::jsonb)) item where item->>'workerId' = p_worker_id;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_linked_ledger from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'workerId' = p_worker_id;

  v_audit_entry := jsonb_build_object('id', v_event_id, 'actor', 'Owner', 'action', 'deleted', 'recordType', 'worker profile', 'recordId', p_worker_id || ' · ' || coalesce(v_worker->>'name', 'Worker'), 'occurredAt', v_now, 'reason', btrim(p_reason), 'details', 'Attendance and wage history retained in the audit log; financial entries remain in the cashbook without worker linkage.');
  select coalesce(jsonb_agg(recent.event order by recent.ordinality desc), '[]'::jsonb) into v_audit_trail
  from (select event, ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail', '[]'::jsonb) || jsonb_build_array(v_audit_entry)) with ordinality as entries(event, ordinality) order by ordinality desc limit 5000) recent;

  v_snapshot := jsonb_set(v_row.snapshot, '{workers}', (select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'workers', '[]'::jsonb)) item where item->>'id' <> p_worker_id));
  v_snapshot := jsonb_set(v_snapshot, '{attendance}', (select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'attendance', '[]'::jsonb)) item where item->>'workerId' <> p_worker_id));
  v_snapshot := jsonb_set(v_snapshot, '{wageHistory}', (select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'wageHistory', '[]'::jsonb)) item where item->>'workerId' <> p_worker_id));
  v_snapshot := jsonb_set(v_snapshot, '{ledger}', (select coalesce(jsonb_agg(item - 'workerId'), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'workerId' = p_worker_id) || (select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'workerId' <> p_worker_id));
  v_snapshot := jsonb_set(v_snapshot, '{overtimeCarry}', coalesce(v_snapshot->'overtimeCarry', '{}'::jsonb) - p_worker_id);
  v_snapshot := jsonb_set(v_snapshot, '{auditTrail}', v_audit_trail);

  v_revision := gen_random_uuid();
  update public.workspace_snapshots set revision = v_revision, snapshot = v_snapshot, updated_at = v_now where user_id = v_user;
  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values ('workspace', p_worker_id, 'DELETE', jsonb_build_object('worker', v_worker, 'reason', btrim(p_reason), 'attendance', v_attendance, 'wage_history', v_wages, 'ledger_entries', v_linked_ledger, 'overtime_hours', coalesce(v_row.snapshot->'overtimeCarry'->p_worker_id, '0'::jsonb)), v_user, v_event_id)
  on conflict (source_event_id) do nothing;
  return jsonb_build_object('status', 'deleted', 'revision', v_revision, 'snapshot', v_snapshot, 'event_id', v_event_id);
end
$function$;
revoke all on function public.delete_worker_from_workspace(text, uuid, text, text) from public, anon;
grant execute on function public.delete_worker_from_workspace(text, uuid, text, text) to authenticated;

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
  v_audit_entry := jsonb_build_object('id', v_event_id, 'actor', 'Owner', 'action', 'deleted', 'recordType', 'ledger entry', 'recordId', coalesce(v_entry->>'kind','transaction') || ' · ' || coalesce(v_entry->>'description',''), 'occurredAt', v_now, 'reason', btrim(p_reason));
  select coalesce(jsonb_agg(recent.event order by recent.ordinality desc), '[]'::jsonb) into v_audit_trail
  from (select event, ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail', '[]'::jsonb) || jsonb_build_array(v_audit_entry)) with ordinality as entries(event, ordinality) order by ordinality desc limit 5000) recent;
  v_snapshot := jsonb_set(v_row.snapshot, '{ledger}', (select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) item where item->>'id' <> p_entry_id));
  v_snapshot := jsonb_set(v_snapshot, '{auditTrail}', v_audit_trail);
  v_revision := gen_random_uuid();
  update public.workspace_snapshots set revision = v_revision, snapshot = v_snapshot, updated_at = v_now where user_id = v_user;
  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values ('workspace', p_entry_id, 'DELETE', jsonb_build_object('ledger_entry', v_entry, 'reason', btrim(p_reason)), v_user, v_event_id) on conflict (source_event_id) do nothing;
  return jsonb_build_object('status', 'deleted', 'revision', v_revision, 'snapshot', v_snapshot, 'event_id', v_event_id);
end
$function$;
revoke all on function public.delete_ledger_entry_from_workspace(text, uuid, text, text) from public, anon;
grant execute on function public.delete_ledger_entry_from_workspace(text, uuid, text, text) to authenticated;
