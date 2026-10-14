-- Lakshmi Fabrication schema. Apply only to the confirmed project after review.
create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'viewer' check (role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.user_profiles where user_id = auth.uid() $$;
revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

-- Local-first workspace sync uses optimistic revision checks so an offline
-- device can never silently replace a newer cloud copy.
create table if not exists public.workspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null default gen_random_uuid(),
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_snapshots enable row level security;
drop policy if exists owner_read_workspace_snapshot on public.workspace_snapshots;
create policy owner_read_workspace_snapshot on public.workspace_snapshots for select to authenticated
  using (user_id = auth.uid() and public.current_app_role() = 'owner');
revoke all on public.workspace_snapshots from anon, authenticated;
grant select on public.workspace_snapshots to authenticated;

create or replace function public.sync_workspace_snapshot(expected_revision uuid, next_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_row public.workspace_snapshots%rowtype; v_revision uuid;
begin
  if v_user is null or public.current_app_role() <> 'owner' then raise exception 'Owner access required'; end if;
  if jsonb_typeof(next_snapshot) is distinct from 'object' or next_snapshot->>'version' is distinct from '1'
     or jsonb_typeof(next_snapshot->'workers') is distinct from 'array' or jsonb_typeof(next_snapshot->'contracts') is distinct from 'array'
     or jsonb_typeof(next_snapshot->'attendance') is distinct from 'array' or jsonb_typeof(next_snapshot->'ledger') is distinct from 'array'
     or jsonb_typeof(next_snapshot->'overtimeCarry') is distinct from 'object'
     or jsonb_typeof(next_snapshot->'auditTrail') is distinct from 'array' then raise exception 'Invalid workspace snapshot'; end if;
  select * into v_row from public.workspace_snapshots where user_id=v_user for update;
  if not found then
    if expected_revision is not null then return jsonb_build_object('status','conflict'); end if;
    v_revision := gen_random_uuid();
    insert into public.workspace_snapshots(user_id,revision,snapshot) values(v_user,v_revision,next_snapshot)
      on conflict (user_id) do nothing;
    if not found then
      select * into v_row from public.workspace_snapshots where user_id=v_user;
      return jsonb_build_object('status','conflict','revision',v_row.revision,'snapshot',v_row.snapshot,'updated_at',v_row.updated_at);
    end if;
    insert into public.audit_log(table_name,record_key,action,actor_id,source_event_id)
      select 'workspace', e->>'recordId', case when e->>'action'='added' then 'INSERT' else 'UPDATE' end, v_user, (e->>'id')::uuid
      from jsonb_array_elements(next_snapshot->'auditTrail') e on conflict (source_event_id) do nothing;
    return jsonb_build_object('status','saved','revision',v_revision,'snapshot',next_snapshot,'updated_at',now());
  end if;
  if expected_revision is null or expected_revision <> v_row.revision then
    return jsonb_build_object('status','conflict','revision',v_row.revision,'snapshot',v_row.snapshot,'updated_at',v_row.updated_at);
  end if;
  v_revision := gen_random_uuid();
  update public.workspace_snapshots set revision=v_revision,snapshot=next_snapshot,updated_at=now() where user_id=v_user;
  insert into public.audit_log(table_name,record_key,action,actor_id,source_event_id)
    select 'workspace', e->>'recordId', case when e->>'action'='added' then 'INSERT' else 'UPDATE' end, v_user, (e->>'id')::uuid
    from jsonb_array_elements(next_snapshot->'auditTrail') e on conflict (source_event_id) do nothing;
  return jsonb_build_object('status','saved','revision',v_revision,'snapshot',next_snapshot,'updated_at',now());
end $$;
revoke all on function public.sync_workspace_snapshot(uuid,jsonb) from public;
grant execute on function public.sync_workspace_snapshot(uuid,jsonb) to authenticated;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  contact_name text,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists companies_name_active_unique on public.companies (lower(name)) where archived_at is null;

create table if not exists public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  city text not null default '',
  state text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_code text not null unique,
  company_id uuid not null references public.companies(id),
  title text not null,
  scope text not null default '',
  contract_type text not null check (contract_type in ('mill_setup','maintenance','other')),
  location_id uuid references public.work_locations(id),
  amount_paise bigint not null check (amount_paise >= 0),
  status text not null default 'active' check (status in ('active','complete','paused','cancelled')),
  started_on date,
  completed_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.contract_receipts (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  received_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null default 'cash' check (method in ('cash','bank','upi','cheque','other')),
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id),
  work_location_id uuid references public.work_locations(id),
  name text not null,
  category text not null default 'instrument',
  serial_number text not null default '',
  quantity integer not null default 1 check (quantity >= 0),
  condition text not null default 'good' check (condition in ('good','repair','retired','lost')),
  acquired_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  maintenance_on date not null,
  description text not null,
  cost_paise bigint not null default 0 check (cost_paise >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.workers (
  labour_id char(4) primary key check (labour_id ~ '^[0-9]{4}$'),
  full_name text not null,
  phone text not null default '',
  worker_type text not null check (worker_type in ('labour','mistri')),
  lifecycle text not null default 'active' check (lifecycle in ('active','inactive','archived')),
  joined_on date not null default current_date,
  archived_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wage_agreements (
  id uuid primary key default gen_random_uuid(),
  labour_id char(4) not null references public.workers(labour_id),
  wage_method text not null check (wage_method in ('daily','monthly','contract')),
  amount_paise bigint not null check (amount_paise >= 0),
  effective_from date not null,
  effective_to date,
  overtime_policy jsonb not null default '{"hours_per_attendance":8,"carry_remainder":true}'::jsonb,
  confirmed_by uuid not null references auth.users(id),
  confirmation_note text not null default '',
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists one_current_wage_agreement_per_worker on public.wage_agreements(labour_id) where effective_to is null;
create table if not exists public.wage_adjustments (
  id uuid primary key default gen_random_uuid(),
  labour_id char(4) not null references public.workers(labour_id),
  amount_paise bigint not null,
  adjustment_type text not null check (adjustment_type in ('bonus','deduction','correction','other')),
  reason text not null,
  applied_on date not null default current_date,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  labour_id char(4) not null references public.workers(labour_id),
  work_date date not null,
  regular_hours numeric(4,2) not null default 0 check (regular_hours >= 0 and regular_hours <= 8),
  overtime_hours numeric(5,2) not null default 0 check (overtime_hours >= 0),
  status text not null check (status in ('P','A')),
  approved_by uuid not null references auth.users(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (labour_id, work_date),
  check ((status = 'A' and regular_hours = 0) or (status = 'P' and regular_hours = 8))
);
create table if not exists public.overtime_carry (
  labour_id char(4) primary key references public.workers(labour_id),
  remainder_hours numeric(5,2) not null default 0 check (remainder_hours >= 0 and remainder_hours < 8),
  completed_blocks bigint not null default 0 check (completed_blocks >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_contract_assignments (
  id uuid primary key default gen_random_uuid(),
  labour_id char(4) not null references public.workers(labour_id),
  contract_id uuid not null references public.contracts(id),
  assigned_from date not null default current_date,
  assigned_to date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (assigned_to is null or assigned_to >= assigned_from)
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('company_receipt','labour_payment','advance','project_expense','equipment_cost','family_transfer','personal_expense')),
  amount_paise bigint not null check (amount_paise > 0),
  description text not null,
  company_id uuid references public.companies(id),
  contract_id uuid references public.contracts(id),
  labour_id char(4) references public.workers(labour_id),
  equipment_id uuid references public.equipment(id),
  payment_method text not null default 'cash' check (payment_method in ('cash','bank','upi','cheque','other')),
  receipt_reference text not null default '',
  approved_by uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text not null default '',
  check (entry_type <> 'company_receipt' or contract_id is not null),
  check (entry_type not in ('labour_payment','advance') or labour_id is not null)
);
create index if not exists ledger_entries_date_idx on public.ledger_entries(entry_date desc) where voided_at is null;
create index if not exists attendance_date_idx on public.attendance(work_date desc);
create index if not exists worker_assignments_contract_idx on public.worker_contract_assignments(contract_id, assigned_from);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_key text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb,
  actor_id uuid default auth.uid() references auth.users(id),
  source_event_id uuid unique,
  occurred_at timestamptz not null default now()
);
create or replace function public.capture_audit_log()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log(table_name,record_key,action,before_data,after_data,actor_id)
  values (tg_table_name, coalesce(to_jsonb(new)->>tg_argv[0],to_jsonb(old)->>tg_argv[0]), tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end, auth.uid());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.capture_audit_log() from public;

do $$ declare t text; begin
  foreach t in array array['companies','work_locations','contracts','contract_receipts','equipment','equipment_maintenance','wage_agreements','wage_adjustments','worker_contract_assignments','ledger_entries'] loop
    execute format('drop trigger if exists %I_audit on public.%I',t,t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.capture_audit_log(''id'')',t,t);
  end loop;
end $$;
drop trigger if exists overtime_carry_audit on public.overtime_carry;
create trigger overtime_carry_audit after insert or update or delete on public.overtime_carry for each row execute function public.capture_audit_log('labour_id');
drop trigger if exists workers_audit on public.workers;
create trigger workers_audit after insert or update or delete on public.workers for each row execute function public.capture_audit_log('labour_id');
drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance for each row execute function public.capture_audit_log('id');

do $$ declare t text; begin
  foreach t in array array['user_profiles','companies','work_locations','contracts','contract_receipts','equipment','equipment_maintenance','workers','wage_agreements','wage_adjustments','attendance','overtime_carry','worker_contract_assignments','ledger_entries','audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I','authenticated_select_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using (public.current_app_role() in (''owner'',''manager'',''viewer''))','authenticated_select_'||t,t);
    execute format('drop policy if exists %I on public.%I','owner_write_'||t,t);
    if t = 'audit_log' then
      execute format('create policy %I on public.%I for insert to authenticated with check (false)','owner_write_'||t,t);
    else
      execute format('create policy %I on public.%I for all to authenticated using (public.current_app_role() = ''owner'') with check (public.current_app_role() = ''owner'')','owner_write_'||t,t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.user_profiles, public.companies, public.work_locations, public.contracts,
  public.contract_receipts, public.equipment, public.equipment_maintenance, public.workers, public.wage_agreements,
  public.wage_adjustments, public.attendance, public.overtime_carry, public.worker_contract_assignments,
  public.ledger_entries to authenticated;
grant select on public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

