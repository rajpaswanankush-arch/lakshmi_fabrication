-- Clear test business data for a client handoff without changing Auth users.
-- The previous complete snapshot is retained in audit_log.before_data.
create or replace function public.reset_workspace_for_client(
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
  v_snapshot jsonb;
  v_revision uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if confirmation_text is distinct from 'RESET WORKSPACE' then
    raise exception using errcode = '22023', message = 'Type RESET WORKSPACE to confirm';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then
    raise exception using errcode = '22023', message = 'Enter a short reason (3 to 300 characters)';
  end if;

  select * into v_row
  from public.workspace_snapshots
  where user_id = v_user
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if expected_revision is null or expected_revision <> v_row.revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_row.revision, 'snapshot', v_row.snapshot);
  end if;

  -- Preserve the full original data and reason for recovery. This table is not
  -- exposed to the app client; Auth accounts and workspace policies are untouched.
  insert into public.audit_log(table_name, record_key, action, before_data, actor_id, source_event_id)
  values (
    'workspace', 'client-handoff-reset', 'DELETE',
    jsonb_build_object('reason', btrim(p_reason), 'snapshot', v_row.snapshot, 'reset_at', v_now),
    v_user, v_event_id
  ) on conflict (source_event_id) do nothing;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'monthlyWageReminderDay', coalesce(v_row.snapshot->'monthlyWageReminderDay', '1'::jsonb),
    'workers', '[]'::jsonb,
    'companies', '[]'::jsonb,
    'contracts', '[]'::jsonb,
    'equipment', '[]'::jsonb,
    'maintenance', '[]'::jsonb,
    'attendance', '[]'::jsonb,
    'ledger', '[]'::jsonb,
    'wageHistory', '[]'::jsonb,
    'auditTrail', '[]'::jsonb,
    'overtimeCarry', '{}'::jsonb,
    'updatedAt', v_now
  );
  if v_row.snapshot ? 'brandLogo' then
    v_snapshot := jsonb_set(v_snapshot, '{brandLogo}', v_row.snapshot->'brandLogo', true);
  end if;
  update public.workspace_snapshots
  set revision = v_revision, snapshot = v_snapshot, updated_at = v_now
  where user_id = v_user;
  return jsonb_build_object('status', 'reset', 'revision', v_revision, 'snapshot', v_snapshot, 'archive_event_id', v_event_id);
end
$function$;

revoke all on function public.reset_workspace_for_client(uuid, text, text) from public, anon;
grant execute on function public.reset_workspace_for_client(uuid, text, text) to authenticated;
