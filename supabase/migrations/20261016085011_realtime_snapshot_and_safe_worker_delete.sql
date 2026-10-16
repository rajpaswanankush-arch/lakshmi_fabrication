-- The current application stores its business workspace in one owner-scoped
-- snapshot. Publish only that row so authenticated owners can refresh quickly;
-- the existing RLS SELECT policy remains the authorization boundary.
do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workspace_snapshots'
     ) then
    alter publication supabase_realtime add table public.workspace_snapshots;
  end if;
end
$publication$;

-- Worker deletion is a dedicated, revision-checked owner operation. The
-- generic snapshot RPC cannot enforce worker-specific retention rules because
-- it accepts a complete client snapshot.
create or replace function public.delete_worker_from_workspace(
  p_worker_id text,
  expected_revision uuid,
  confirmation_text text
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
  v_reasons jsonb := '[]'::jsonb;
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
  if p_worker_id is null or p_worker_id !~ '^\d{4}$' then
    raise exception using errcode = '22023', message = 'Invalid worker ID';
  end if;

  select * into v_row
  from public.workspace_snapshots
  where user_id = v_user
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if expected_revision is null or expected_revision <> v_row.revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_row.revision, 'snapshot', v_row.snapshot, 'updated_at', v_row.updated_at);
  end if;

  select item into v_worker
  from jsonb_array_elements(coalesce(v_row.snapshot->'workers', '[]'::jsonb)) as workers(item)
  where item->>'id' = p_worker_id
  limit 1;
  if v_worker is null then
    return jsonb_build_object('status', 'not_found', 'revision', v_row.revision, 'snapshot', v_row.snapshot);
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'attendance', '[]'::jsonb)) as attendance(item) where item->>'workerId' = p_worker_id) then
    v_reasons := v_reasons || jsonb_build_array('attendance');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger', '[]'::jsonb)) as ledger(item) where item->>'workerId' = p_worker_id) then
    v_reasons := v_reasons || jsonb_build_array('financial entries');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'wageHistory', '[]'::jsonb)) as wage_history(item) where item->>'workerId' = p_worker_id) then
    v_reasons := v_reasons || jsonb_build_array('approved wage history');
  end if;
  if coalesce((v_row.snapshot->'overtimeCarry'->>p_worker_id)::numeric, 0) > 0 then
    v_reasons := v_reasons || jsonb_build_array('overtime balance');
  end if;
  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object('status', 'blocked', 'reasons', v_reasons, 'revision', v_row.revision, 'snapshot', v_row.snapshot);
  end if;

  v_audit_entry := jsonb_build_object(
    'id', v_event_id,
    'actor', 'Owner',
    'action', 'deleted',
    'recordType', 'worker profile',
    'recordId', p_worker_id || ' · ' || coalesce(v_worker->>'name', 'Worker'),
    'occurredAt', v_now
  );
  select coalesce(jsonb_agg(recent.event order by recent.ordinality desc), '[]'::jsonb)
    into v_audit_trail
  from (
    select event, ordinality
    from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail', '[]'::jsonb) || jsonb_build_array(v_audit_entry)) with ordinality as entries(event, ordinality)
    order by ordinality desc
    limit 5000
  ) recent;

  v_snapshot := jsonb_set(v_row.snapshot, '{workers}', (
    select coalesce(jsonb_agg(item), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_row.snapshot->'workers', '[]'::jsonb)) as workers(item)
    where item->>'id' <> p_worker_id
  ));
  v_snapshot := jsonb_set(v_snapshot, '{overtimeCarry}', coalesce(v_snapshot->'overtimeCarry', '{}'::jsonb) - p_worker_id);
  v_snapshot := jsonb_set(v_snapshot, '{auditTrail}', v_audit_trail);

  v_revision := gen_random_uuid();
  update public.workspace_snapshots
  set revision = v_revision, snapshot = v_snapshot, updated_at = v_now
  where user_id = v_user;

  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values ('workspace', p_worker_id, 'DELETE', jsonb_build_object('worker', v_worker), v_user, v_event_id)
  on conflict (source_event_id) do nothing;

  return jsonb_build_object('status', 'deleted', 'revision', v_revision, 'snapshot', v_snapshot, 'event_id', v_event_id);
end
$function$;

revoke all on function public.delete_worker_from_workspace(text, uuid, text) from public, anon;
grant execute on function public.delete_worker_from_workspace(text, uuid, text) to authenticated;
