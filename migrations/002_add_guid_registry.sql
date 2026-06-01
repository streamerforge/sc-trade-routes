-- Migration 002 — Table GUID Registry
-- À exécuter dans : Cloudflare Dashboard → D1 → sf-trade-data → Console

CREATE TABLE IF NOT EXISTS guid_registry (
    guid            TEXT PRIMARY KEY,
    commodity_name  TEXT NOT NULL,
    commodity_code  TEXT DEFAULT '',
    confirmed_count INTEGER DEFAULT 1,
    first_seen      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guid ON guid_registry(guid);
