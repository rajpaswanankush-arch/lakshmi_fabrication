drop policy if exists owner_write_user_profiles on public.user_profiles;
create policy owner_insert_user_profiles on public.user_profiles for insert to authenticated
  with check (public.current_app_role() = 'owner');
create policy owner_update_user_profiles on public.user_profiles for update to authenticated
  using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy owner_delete_user_profiles on public.user_profiles for delete to authenticated
  using (public.current_app_role() = 'owner');
