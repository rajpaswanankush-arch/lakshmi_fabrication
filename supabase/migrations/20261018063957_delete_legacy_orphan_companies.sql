-- A company synthesized from a legacy contract has no companies[] row in the
-- cloud snapshot. Allow its Owner to remove the matching orphaned contract,
-- while retaining the complete company/contract payload in audit_log.
create or replace function public.delete_company_from_workspace(
  p_company_id text, expected_revision uuid, confirmation_text text
) returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := auth.uid();
  v_row public.workspace_snapshots%rowtype;
  v_company jsonb;
  v_contract_ids text[] := '{}'::text[];
  v_contracts jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_event uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_revision uuid;
  v_snapshot jsonb;
  v_audit jsonb;
  v_legacy_name text;
begin
  if v_user is null or public.current_app_role() is distinct from 'owner' then
    raise exception using errcode='42501', message='Owner access required';
  end if;
  if confirmation_text is distinct from 'DELETE' then
    raise exception using errcode='22023', message='Type DELETE to confirm';
  end if;
  if p_company_id is null then
    raise exception using errcode='22023', message='Invalid company ID';
  end if;

  select * into v_row from public.workspace_snapshots where user_id=v_user for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if expected_revision is null or expected_revision<>v_row.revision then
    return jsonb_build_object('status','conflict','revision',v_row.revision,'snapshot',v_row.snapshot);
  end if;

  select item into v_company
  from jsonb_array_elements(coalesce(v_row.snapshot->'companies','[]'::jsonb)) as rows(item)
  where item->>'id'=p_company_id limit 1;

  -- Older snapshots only store a company name on contracts. validateBackup()
  -- exposes these as legacy-<slug> companies, so resolve that exact ID only
  -- when it uniquely identifies companyId-less contracts in the locked row.
  if v_company is null and p_company_id like 'legacy-%' then
    select min(item->>'company') into v_legacy_name
    from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item)
    where nullif(item->>'companyId','') is null
      and p_company_id = 'legacy-' || trim(both '-' from regexp_replace(lower(trim(item->>'company')), '[^a-z0-9]+', '-', 'g'))
    having count(distinct lower(trim(item->>'company'))) = 1;
    if v_legacy_name is not null then
      v_company := jsonb_build_object('id',p_company_id,'name',trim(v_legacy_name));
    end if;
  end if;
  if v_company is null then
    return jsonb_build_object('status','not_found','revision',v_row.revision,'snapshot',v_row.snapshot);
  end if;

  if coalesce(v_company->>'logoPath','')<>'' then
    v_reasons:=v_reasons||jsonb_build_array('remove the company logo first');
  end if;
  select coalesce(array_agg(item->>'id'),'{}'::text[]) into v_contract_ids
  from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item)
  where item->>'companyId'=p_company_id
     or (item->>'companyId' is null and lower(trim(item->>'company'))=lower(trim(v_company->>'name')));
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'ledger','[]'::jsonb)) as rows(item) where item->>'contractId'=any(v_contract_ids)) then
    v_reasons:=v_reasons||jsonb_build_array('linked receipts or accounting entries');
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_row.snapshot->'equipment','[]'::jsonb)) as rows(item) where item->>'contractId'=any(v_contract_ids)) then
    v_reasons:=v_reasons||jsonb_build_array('equipment assigned to a contract');
  end if;
  if jsonb_array_length(v_reasons)>0 then
    return jsonb_build_object('status','blocked','reasons',v_reasons,'revision',v_row.revision,'snapshot',v_row.snapshot,'contract_ids',to_jsonb(v_contract_ids));
  end if;

  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_contracts
  from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item)
  where item->>'id'=any(v_contract_ids);
  v_snapshot:=jsonb_set(v_row.snapshot,'{companies}',(
    select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'companies','[]'::jsonb)) as rows(item) where item->>'id'<>p_company_id
  ));
  v_snapshot:=jsonb_set(v_snapshot,'{contracts}',(
    select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row.snapshot->'contracts','[]'::jsonb)) as rows(item) where not (item->>'id'=any(v_contract_ids))
  ));
  v_audit:=jsonb_build_object('id',v_event,'actor','Owner','action','deleted','recordType','company','recordId',p_company_id||' · '||coalesce(v_company->>'name','Company'),'occurredAt',v_now);
  v_snapshot:=jsonb_set(v_snapshot,'{auditTrail}',(
    select coalesce(jsonb_agg(item order by ordinality desc),'[]'::jsonb)
    from (select item,ordinality from jsonb_array_elements(coalesce(v_row.snapshot->'auditTrail','[]'::jsonb)||jsonb_build_array(v_audit)) with ordinality as a(item,ordinality) order by ordinality desc limit 5000) q
  ));
  v_revision:=gen_random_uuid();
  update public.workspace_snapshots set revision=v_revision,snapshot=v_snapshot,updated_at=v_now where user_id=v_user;
  insert into public.audit_log(table_name,record_key,action,before_data,actor_id,source_event_id)
  values('workspace',p_company_id,'DELETE',jsonb_build_object('company',v_company,'contracts',v_contracts),v_user,v_event)
  on conflict(source_event_id) do nothing;
  return jsonb_build_object('status','deleted','revision',v_revision,'snapshot',v_snapshot,'event_id',v_event,'contracts_deleted',cardinality(v_contract_ids));
end $function$;

revoke all on function public.delete_company_from_workspace(text,uuid,text) from public,anon;
grant execute on function public.delete_company_from_workspace(text,uuid,text) to authenticated;
