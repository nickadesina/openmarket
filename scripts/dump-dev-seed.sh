#!/usr/bin/env sh
# Regenerates scripts/dev-seed.sql from DATABASE_URL_UNPOOLED as column-insert
# statements, the same shape pg_dump --column-inserts produces. Uses psql only,
# so a client/server major-version mismatch (which aborts pg_dump) is harmless.
set -eu
out="$(dirname "$0")/dev-seed.sql"
{
  echo "--"
  echo "-- OpenMarket development seed: a snapshot of real paper trading."
  echo "-- Regenerate with scripts/dump-dev-seed.sh; verify with npm run verify:replay first."
  echo "--"
  echo "SET client_encoding = 'UTF8';"
  echo "SET standard_conforming_strings = on;"
  echo "SELECT pg_catalog.set_config('search_path', '', false);"
  echo
  for spec in "companies:created_at" "markets:created_at" "users:created_at" "holdings:user_id, market_id" "trades:created_at, market_sequence" "marks:market_id, market_sequence" "settlements:ts"; do
    table="${spec%%:*}"
    order="${spec#*:}"
    echo "-- Data for Name: $table; Type: TABLE DATA; Schema: public"
    psql "$DATABASE_URL_UNPOOLED" -qtAX --set ON_ERROR_STOP=1 -c "
      select format(
        'select format(''INSERT INTO public.%I (%s) VALUES (%%s);'', concat_ws('', '', %s)) from public.%I order by %s',
        '$table',
        string_agg(quote_ident(column_name), ', ' order by ordinal_position),
        string_agg(format('quote_nullable(%I::text)', column_name), ', ' order by ordinal_position),
        '$table',
        '$order'
      )
      from information_schema.columns
      where table_schema = 'public' and table_name = '$table'" \
    | psql "$DATABASE_URL_UNPOOLED" -qtAX --set ON_ERROR_STOP=1 -f -
    echo
  done
  echo "-- Development seed complete"
} > "$out"
echo "wrote $out ($(grep -c '^INSERT' "$out") rows)"
