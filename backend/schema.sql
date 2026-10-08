-- ==========================================================================
-- GLIDE 2000 - SCHEMA POSTGRESQL
-- Une table par table Airtable, donnees stockees en JSONB (format identique
-- aux "fields" Airtable, ids recXXX conserves pour preserver les liens).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS reservations (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aeronefs (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS utilisateurs (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evenements (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disponibilites_instructeurs (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carnet_route_pilotes (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carnet_route (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presences_planeur (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presences_club (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comptes_pilotes (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messagerie (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents_aeronefs (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vi_creneaux (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vi_planeur (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dossiers (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carnet_vol (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signalements (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index sur les champs dates les plus filtres (acceleration des requetes)
CREATE INDEX IF NOT EXISTS idx_reservations_debut ON reservations ((fields->>'Date de début'));
CREATE INDEX IF NOT EXISTS idx_reservations_fin   ON reservations ((fields->>'Date de fin'));
CREATE INDEX IF NOT EXISTS idx_maintenance_date   ON maintenance ((fields->>'Date'));
CREATE INDEX IF NOT EXISTS idx_carnet_pilotes_date ON carnet_route_pilotes ((fields->>'Date'));
CREATE INDEX IF NOT EXISTS idx_carnet_vol_pilote ON carnet_vol ((fields->>'Pilote'));
CREATE INDEX IF NOT EXISTS idx_carnet_vol_date   ON carnet_vol ((fields->>'Date'));
CREATE INDEX IF NOT EXISTS idx_messagerie_date    ON messagerie ((fields->>'Date'));
CREATE INDEX IF NOT EXISTS idx_evenements_debut   ON evenements ((fields->>'Date de début'));

CREATE TABLE IF NOT EXISTS gvv_soldes (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gvv_ecritures (
    id          TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gvv_ecritures_compte ON gvv_ecritures ((fields->>'Compte'));
CREATE INDEX IF NOT EXISTS idx_gvv_ecritures_date   ON gvv_ecritures ((fields->>'Date'));

-- Sessions utilisateurs (jetons emis par /v0/auth/login)
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expire_le   TIMESTAMPTZ NOT NULL
);
