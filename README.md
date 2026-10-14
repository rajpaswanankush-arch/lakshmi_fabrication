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

## Supabase setup

The initial migration and subsequent owner-only access hardening are in `supabase/migrations/`. They create the workforce, wage, attendance, contract, equipment, ledger and audit tables, owner-only read/write policies, and revision-checked local-first snapshot sync. These additive migrations have been applied to the connected empty Supabase project; no worker, payroll or contract data was added.

Create the first sign-in in Supabase Auth (public sign-up remains disabled), then assign its UUID as owner in SQL Editor:

```sql
insert into public.user_profiles (user_id, display_name, role)
values ('<AUTH_USER_UUID>', 'Owner', 'owner')
on conflict (user_id) do update set role = 'owner', updated_at = now();
```

Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Only the owner role can read or change workspace data. The app sync button uses compare-and-set revisions and requires an explicit choice if a newer cloud copy exists. Keep the downloadable backup separate from this project.

## Current implementation notes

- Four-digit Labour IDs are validated and unique.
- Attendance marks either `P` (8 regular hours) or `A`; overtime is stored separately and only full accumulated 8-hour blocks become attendance equivalents. Remainders carry forward.
- Monthly agreements remain fixed through absences. New or changed wage amounts require an explicit Owner confirmation and retain a dated history entry.
- Payroll preview includes the full monthly agreement and daily attendance equivalents, including completed overtime blocks. It never applies an absence deduction.
- Backup files are capped at 50 MB, include SHA-256 integrity validation, and are fully checked before the restore confirmation can replace local records.
- The PWA caches only the app shell and Next static assets. API/auth traffic is not cached.
- Owner settings include company logo editing, password recovery by email, and monthly wage due-day reminders. Browser wage reminders require notification permission and the app to be open or active; background push delivery still needs a scheduled sender and private server keys.
- The item-by-item equipment register and maintenance-cost screen are included. Paper/digital record import, multi-device end-to-end browser verification, creating the first Auth account and assigning its owner role, and deployment are still pending. Worker photos are locally cropped/compressed and included in the private owner-only snapshot/backup.
