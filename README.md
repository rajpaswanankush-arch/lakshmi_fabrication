# Lakshmi Fabrication

A minimal Hindi/English workforce, attendance, contract and cashbook app with a local-first PWA shell and a separate integrity-checked backup/restore path.

## Run locally

1. Copy `.env.example` to `.env.local` and fill the Supabase project URL and publishable/anon key after the approved schema setup.
2. Run `npm install`, then `npm run dev`.
3. Without Supabase configuration the interface opens in **Preview mode** and stores records only in this browser. Do not use Preview mode as the only copy of real payroll records.

## Checks

- `npm run typecheck`
- `npm test`
- `npm run build`

## Supabase setup (pending owner confirmation)

The initial migration is in `supabase/migrations/202610140001_initial_schema.sql`. It creates the normalized workforce, wage, attendance, contract, equipment, ledger and audit tables, owner-only write policies, and revision-checked local-first snapshot sync. The migration has **not** been applied to the connected Supabase project.

After the owner approves the target project and migration, create the first sign-in in Supabase Auth (public sign-up remains disabled), then assign its UUID as owner in SQL Editor:

```sql
insert into public.user_profiles (user_id, display_name, role)
values ('<AUTH_USER_UUID>', 'Father', 'owner')
on conflict (user_id) do update set role = 'owner', updated_at = now();
```

Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Only the owner role can write. The app sync button uses compare-and-set revisions and requires an explicit choice if a newer cloud copy exists. Keep the downloadable backup separate from this project.

## Current implementation notes

- Four-digit Labour IDs are validated and unique.
- Attendance marks either `P` (8 regular hours) or `A`; overtime is stored separately and only full accumulated 8-hour blocks become attendance equivalents. Remainders carry forward.
- Monthly agreements remain fixed through absences. New or changed wage amounts require an explicit Father confirmation and retain a dated history entry.
- Payroll preview includes the full monthly agreement and daily attendance equivalents, including completed overtime blocks. It never applies an absence deduction.
- Backup files are capped at 50 MB, include SHA-256 integrity validation, and are fully checked before the restore confirmation can replace local records.
- The PWA caches only the app shell and Next static assets. API/auth traffic is not cached.
- Paper/digital record import, item-by-item equipment maintenance screens, multi-device end-to-end browser verification, owner bootstrap, migration application, and deployment are still pending review/setup. Worker photos are locally cropped/compressed and included in the private owner-only snapshot/backup.
