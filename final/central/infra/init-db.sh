#!/bin/bash
# PostgreSQL 컨테이너 최초 기동 시 실행.
# hapi database는 POSTGRES_DB 환경변수로 이미 생성되므로,
# 여기서는 central_db database만 추가 생성 + 스키마 적용.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    CREATE DATABASE central_db;
EOSQL

# central_db 스키마 적용 (schema.sql은 /init/에 마운트됨 — hapi DB로 새지 않음)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "central_db" \
    -f /init/schema.sql

echo "✅ central_db database created with schema"
