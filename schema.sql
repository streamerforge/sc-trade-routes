-- SF Trade Data — Schéma D1
-- À exécuter dans Cloudflare Dashboard → D1 → sf-trade-data → Console

CREATE TABLE IF NOT EXISTS price_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_terminal     INTEGER NOT NULL,
    id_commodity    INTEGER NOT NULL,
    terminal_name   TEXT,
    commodity_name  TEXT,
    commodity_code  TEXT,
    price_buy       REAL    DEFAULT 0,
    price_sell      REAL    DEFAULT 0,
    scu_buy         INTEGER DEFAULT 0,
    rsi_handle      TEXT,
    submitted_at    INTEGER NOT NULL,
    confirmed_count INTEGER DEFAULT 0,
    auto_collected  INTEGER DEFAULT 0,  -- 1 = SC Trade Tracker, 0 = formulaire manuel
    source          TEXT    DEFAULT 'manual' -- 'manual' | 'sc_trade_tracker'
);

CREATE TABLE IF NOT EXISTS price_confirmations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id    INTEGER NOT NULL,
    rsi_handle   TEXT,
    price_buy    REAL,
    price_sell   REAL,
    confirmed_at INTEGER NOT NULL,
    FOREIGN KEY (report_id) REFERENCES price_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_term_comm    ON price_reports(id_terminal, id_commodity);
CREATE INDEX IF NOT EXISTS idx_submitted_at ON price_reports(submitted_at);
