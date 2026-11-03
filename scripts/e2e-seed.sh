#!/usr/bin/env bash
# Seeds a LOCAL Supabase stack (supabase start) for the Playwright journey:
#   - registers sha256(INGEST_SECRET) in public.ingest_keys (test pages and sign-up check need it)
#   - allowlists the test domain for the before-user-created hook
#   - creates (or resets) the confirmed E2E user with E2E_EMAIL / E2E_PASSWORD through the Auth admin API
# Refuses to run against anything but localhost: it uses the service-role key.
#
# Usage: eval "$(supabase status -o env)"; INGEST_SECRET=… E2E_EMAIL=… E2E_PASSWORD=… scripts/e2e-seed.sh
set -euo pipefail

: "${API_URL:?API_URL missing (eval \"\$(supabase status -o env)\")}"
: "${DB_URL:?DB_URL missing}"
: "${INGEST_SECRET:?INGEST_SECRET missing}"
: "${E2E_EMAIL:?E2E_EMAIL missing}"
: "${E2E_PASSWORD:?E2E_PASSWORD missing}"
ADMIN_KEY="${SERVICE_ROLE_KEY:-${SECRET_KEY:-}}"
: "${ADMIN_KEY:?SERVICE_ROLE_KEY or SECRET_KEY missing}"

case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing to seed $API_URL: this script is for a local Supabase stack only." >&2; exit 1 ;;
esac

domain="@${E2E_EMAIL#*@}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -v secret="$INGEST_SECRET" -v domain="$domain" <<'SQL'
insert into public.ingest_keys (key_hash)
  values (encode(extensions.digest(:'secret', 'sha256'), 'hex')) on conflict do nothing;
insert into public.signup_allowlist (entry, note)
  values (lower(:'domain'), 'E2E (local stack)') on conflict do nothing;
SQL

body=$(node -e 'process.stdout.write(JSON.stringify({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD, email_confirm: true }))')
status=$(curl -sS -o /tmp/e2e-seed-user.json -w '%{http_code}' -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $ADMIN_KEY" -H "Authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" -d "$body")
if [ "$status" = "200" ] || [ "$status" = "201" ]; then
  echo "E2E user created."
elif [ "$status" = "422" ]; then
  # Already there from an earlier run against the same stack: reset the password so the run is repeatable.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -v email="$E2E_EMAIL" -v pw="$E2E_PASSWORD" <<'SQL'
update auth.users set encrypted_password = extensions.crypt(:'pw', extensions.gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now())
  where email = lower(:'email');
SQL
  echo "E2E user existed; password reset."
else
  echo "Creating the E2E user failed (HTTP $status):" >&2
  cat /tmp/e2e-seed-user.json >&2
  exit 1
fi
rm -f /tmp/e2e-seed-user.json
