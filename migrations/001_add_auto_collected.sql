-- Migration 001 — Ajout colonnes auto_collected et source
-- À exécuter dans : Cloudflare Dashboard → D1 → sf-trade-data → Console

ALTER TABLE price_reports ADD COLUMN auto_collected INTEGER DEFAULT 0;
ALTER TABLE price_reports ADD COLUMN source TEXT DEFAULT 'manual';
