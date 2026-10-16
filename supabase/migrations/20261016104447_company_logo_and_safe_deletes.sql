-- Private company-logo storage and revision-checked Owner deletions for the
-- snapshot-backed application. Existing records are never migrated or removed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists owner_read_company_logos on storage.objects;
create policy owner_read_company_logos on storage.objects for select to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = 'companies' and (storage.foldername(name))[2] = (select auth.uid())::text and public.current_app_role() = 'owner');
drop policy if exists owner_insert_company_logos on storage.objects;
create policy owner_insert_company_logos on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = 'companies' and (storage.foldername(name))[2] = (select auth.uid())::text and public.current_app_role() = 'owner' and lower(storage.extension(name)) in ('jpg','jpeg','png','webp'));
drop policy if exists owner_update_company_logos on storage.objects;
create policy owner_update_company_logos on storage.objects for update to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = 'companies' and (storage.foldername(name))[2] = (select auth.uid())::text and public.current_app_role() = 'owner')
  with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = 'companies' and (storage.foldername(name))[2] = (select auth.uid())::text and public.current_app_role() = 'owner' and lower(storage.extension(name)) in ('jpg','jpeg','png','webp'));
drop policy if exists owner_delete_company_logos on storage.objects;
create policy owner_delete_company_logos on storage.objects for delete to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = 'companies' and (storage.foldername(name))[2] = (select auth.uid())::text and public.current_app_role() = 'owner');

create or replace function public.delete_equipment_from_workspace(
  p_equipment_id text, expected_revision uuid, confirmation_text text
) returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := auth.uid(); v_row public.workspace_snapshots%rowtype;
  v_item jsonb; v_reasons jsonb := '[]'::jsonb; v_event uuid := gen_random_uuid();
  v_now timestamptz := now(); v_revision uuid; v_snapshot jsonb; v_audit jsonb;
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then raise exception using errcode='42501', message='Owner access required'; end if;
  if confirmation_text is distinct from 'DELETE' then raise exception using errcode='22023', message='Type DELETE to confirm'; end if;
  if p_equipment_id is null then raise exception using errcode='22023', message='Invalid equipment ID'; end if;
  select * into v_row from public.workspace_snapshots where user_id=v_user for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if expected_revision is null or expected_revision<>v_row.revision then return jsonb_build_object('status','conflict','revision',v_row.revision,'snapshot',v_row.snapshot); end if;
  select item into v_item from jsonb_array_elements(coalesce(v_row.snapshot->'equipment','[]'::jsonb)) as rows(item) where item->>'id'=p_equipment_id limit 1;
  if v_item is null then return jsonb_build_object('status','not_found','revision',v_row.revision,'snapshot',v_row.snapshot); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'maintenance','[]'::jsonb)) as rows(item) where item->>'equipmentId'=p_equipment_id) then v_reasons:=v_reasons||jsonb_build_array('maintenance history'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger','[]'::jsonb)) as rows(item) where item->>'equipmentId'=p_equipment_id) then v_reasons:=v_reasons||jsonb_build_array('financial entries'); end if;
  if jsonb_array_length(v_reasons)>0 then return jsonb_build_object('status','blocked','reasons',v_reasons,'revision',v_row.revision,'snapshot',v_row.snapshot); end if;
  v_snapshot:=jsonb_set(v_row.snapshot,'{equipment}',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'equipment','[]'::jsonb)) as rows(item) where item->>'id'<>p_equipment_id));
  if nullif(v_item->>'contractId','') is not null then
    v_snapshot:=jsonb_set(v_snapshot,'{contracts}',(
      select coalesce(jsonb_agg(case when item->>'id'=v_item->>'contractId' then
        jsonb_set(item,'{instruments}',to_jsonb(greatest(0,coalesce((item->>'instruments')::integer,0)-coalesce((v_item->>'quantity')::integer,0))))
        else item end),'[]'::jsonb)
      from jsonb_array_elements(coalesce(v_snapshot->'contracts','[]'::jsonb)) as rows(item)
    ));
  end if;
  v_audit:=jsonb_build_object('id',v_event,'actor','Owner','action','deleted','recordType','equipment','recordId',p_equipment_id||' · '||coalesce(v_item->>'name','Equipment'),'occurredAt',v_now);
  v_snapshot:=jsonb_set(v_snapshot,'{auditTrail}',(select coalesce(jsonb_agg(item order by ordinality desc),'[]'::jsonb) from (select item,ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail','[]'::jsonb)||jsonb_build_array(v_audit)) with ordinality as a(item,ordinality) order by ordinality desc limit 5000) q));
  v_revision:=gen_random_uuid(); update public.workspace_snapshots set revision=v_revision,snapshot=v_snapshot,updated_at=v_now where user_id=v_user;
  insert into public.audit_log(table_name,record_key,action,before_data,actor_id,source_event_id) values('workspace',p_equipment_id,'DELETE',jsonb_build_object('equipment',v_item),v_user,v_event) on conflict(source_event_id) do nothing;
  return jsonb_build_object('status','deleted','revision',v_revision,'snapshot',v_snapshot,'event_id',v_event);
end $function$;

create or replace function public.delete_company_from_workspace(
  p_company_id text, expected_revision uuid, confirmation_text text
) returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := auth.uid(); v_row public.workspace_snapshots%rowtype; v_company jsonb;
  v_contract_ids text[]; v_contracts jsonb; v_reasons jsonb := '[]'::jsonb; v_event uuid := gen_random_uuid();
  v_now timestamptz := now(); v_revision uuid; v_snapshot jsonb; v_audit jsonb;
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then raise exception using errcode='42501', message='Owner access required'; end if;
  if confirmation_text is distinct from 'DELETE' then raise exception using errcode='22023', message='Type DELETE to confirm'; end if;
  if p_company_id is null then raise exception using errcode='22023', message='Invalid company ID'; end if;
  select * into v_row from public.workspace_snapshots where user_id=v_user for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if expected_revision is null or expected_revision<>v_row.revision then return jsonb_build_object('status','conflict','revision',v_row.revision,'snapshot',v_row.snapshot); end if;
  select item into v_company from jsonb_array_elements(coalesce(v_row.snapshot->'companies','[]'::jsonb)) as rows(item) where item->>'id'=p_company_id limit 1;
  if v_company is null then return jsonb_build_object('status','not_found','revision',v_row.revision,'snapshot',v_row.snapshot); end if;
  if coalesce(v_company->>'logoPath','')<>'' then v_reasons:=v_reasons||jsonb_build_array('remove the company logo first'); end if;
  select coalesce(array_agg(item->>'id'),'{}'::text[]) into v_contract_ids from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item) where item->>'companyId'=p_company_id or (item->>'companyId' is null and lower(trim(item->>'company'))=lower(trim(v_company->>'name')));
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger','[]'::jsonb)) as rows(item) where item->>'contractId'=any(v_contract_ids)) then v_reasons:=v_reasons||jsonb_build_array('linked receipts or accounting entries'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'equipment','[]'::jsonb)) as rows(item) where item->>'contractId'=any(v_contract_ids)) then v_reasons:=v_reasons||jsonb_build_array('equipment assigned to a contract'); end if;
  if jsonb_array_length(v_reasons)>0 then return jsonb_build_object('status','blocked','reasons',v_reasons,'revision',v_row.revision,'snapshot',v_row.snapshot,'contract_ids',to_jsonb(v_contract_ids)); end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_contracts from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item) where item->>'id'=any(v_contract_ids);
  v_snapshot:=jsonb_set(v_row.snapshot,'{companies}',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'companies','[]'::jsonb)) as rows(item) where item->>'id'<>p_company_id));
  v_snapshot:=jsonb_set(v_snapshot,'{contracts}',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item) where not (item->>'id'=any(v_contract_ids))));
  v_audit:=jsonb_build_object('id',v_event,'actor','Owner','action','deleted','recordType','company','recordId',p_company_id||' · '||coalesce(v_company->>'name','Company'),'occurredAt',v_now);
  v_snapshot:=jsonb_set(v_snapshot,'{auditTrail}',(select coalesce(jsonb_agg(item order by ordinality desc),'[]'::jsonb) from (select item,ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail','[]'::jsonb)||jsonb_build_array(v_audit)) with ordinality as a(item,ordinality) order by ordinality desc limit 5000) q));
  v_revision:=gen_random_uuid(); update public.workspace_snapshots set revision=v_revision,snapshot=v_snapshot,updated_at=v_now where user_id=v_user;
  insert into public.audit_log(table_name,record_key,action,before_data,actor_id,source_event_id) values('workspace',p_company_id,'DELETE',jsonb_build_object('company',v_company,'contracts',v_contracts),v_user,v_event) on conflict(source_event_id) do nothing;
  return jsonb_build_object('status','deleted','revision',v_revision,'snapshot',v_snapshot,'event_id',v_event,'contracts_deleted',cardinality(v_contract_ids));
end $function$;

revoke all on function public.delete_equipment_from_workspace(text,uuid,text) from public,anon;
grant execute on function public.delete_equipment_from_workspace(text,uuid,text) to authenticated;
revoke all on function public.delete_company_from_workspace(text,uuid,text) from public,anon;
grant execute on function public.delete_company_from_workspace(text,uuid,text) to authenticated;
