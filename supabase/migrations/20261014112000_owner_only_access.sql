-- Restrict workspace data to the single owner account and keep trigger-only
-- security-definer functions out of the callable PostgREST RPC surface.
revoke execute on function public.capture_audit_log() from public, anon, authenticated;
revoke execute on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;
revoke execute on function public.sync_workspace_snapshot(uuid,jsonb) from public, anon;
grant execute on function public.sync_workspace_snapshot(uuid,jsonb) to authenticated;

drop policy if exists owner_read_workspace_snapshot on public.workspace_snapshots;
create policy owner_read_workspace_snapshot on public.workspace_snapshots for select to authenticated
  using (user_id = (select auth.uid()) and public.current_app_role() = 'owner');

-- The profile is visible to its own signed-in user for role checks. Its write
-- policy still requires an already-authorized owner.
drop policy if exists authenticated_select_user_profiles on public.user_profiles;
drop policy if exists owner_write_user_profiles on public.user_profiles;
create policy owner_read_own_profile on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy owner_write_user_profiles on public.user_profiles for all to authenticated
  using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

-- No manager or viewer role can read payroll, contracts, or personal records.
do $$ declare t text; begin
  foreach t in array array['companies','work_locations','contracts','contract_receipts','equipment','equipment_maintenance','workers','wage_agreements','wage_adjustments','attendance','overtime_carry','worker_contract_assignments','ledger_entries'] loop
    execute format('drop policy if exists %I on public.%I','authenticated_select_'||t,t);
    execute format('drop policy if exists %I on public.%I','owner_write_'||t,t);
    execute format('create policy %I on public.%I for all to authenticated using (public.current_app_role() = ''owner'') with check (public.current_app_role() = ''owner'')','owner_access_'||t,t);
  end loop;
  drop policy if exists authenticated_select_audit_log on public.audit_log;
  drop policy if exists owner_write_audit_log on public.audit_log;
  create policy owner_read_audit_log on public.audit_log for select to authenticated
    using (public.current_app_role() = 'owner');
  create policy no_client_audit_insert on public.audit_log for insert to authenticated with check (false);
end $$;
