#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c 'CREATE DATABASE url_shortener_loadtest'

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /migrations/001_create_urls.sql

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname url_shortener_loadtest \
  -f /migrations/001_create_urls.sql
