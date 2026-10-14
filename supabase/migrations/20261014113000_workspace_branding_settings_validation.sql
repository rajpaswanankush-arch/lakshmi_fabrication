do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_snapshot_logo_valid') then
    alter table public.workspace_snapshots add constraint workspace_snapshot_logo_valid check (
      snapshot->'brandLogo' is null or
      (jsonb_typeof(snapshot->'brandLogo') = 'string' and length(snapshot->>'brandLogo') <= 30000 and snapshot->>'brandLogo' like 'data:image/%;base64,%')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspace_snapshot_reminder_day_valid') then
    alter table public.workspace_snapshots add constraint workspace_snapshot_reminder_day_valid check (
      snapshot->'monthlyWageReminderDay' is null or
      case when jsonb_typeof(snapshot->'monthlyWageReminderDay') = 'number'
        then (snapshot->>'monthlyWageReminderDay')::numeric between 1 and 28
        else false end
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspace_snapshot_reminder_enabled_valid') then
    alter table public.workspace_snapshots add constraint workspace_snapshot_reminder_enabled_valid check (
      snapshot->'wageReminderEnabled' is null or jsonb_typeof(snapshot->'wageReminderEnabled') = 'boolean'
    );
  end if;
end $$;
