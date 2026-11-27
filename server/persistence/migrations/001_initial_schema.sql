-- Shalendar PostgreSQL Initial Schema (001_initial_schema.sql)
-- Compatible with all domain tables from feat/future-improvements
-- plus adaptive persistence (TTL/retention) and accountless security fields.

CREATE TABLE IF NOT EXISTS plans (
  id                         TEXT PRIMARY KEY,
  slug                       TEXT NOT NULL UNIQUE,
  title                      TEXT NOT NULL,
  description                TEXT NOT NULL DEFAULT '',
  location                   TEXT NOT NULL DEFAULT '',
  emoji                      TEXT NOT NULL DEFAULT '🍕',
  start_month                TEXT NOT NULL,
  end_month                  TEXT NOT NULL,
  max_votes_per_user         INTEGER NOT NULL DEFAULT 3,
  voting_open                BOOLEAN NOT NULL DEFAULT TRUE,
  voting_deadline            TIMESTAMPTZ,
  blind_voting               BOOLEAN NOT NULL DEFAULT FALSE,
  granularity                TEXT NOT NULL DEFAULT 'day'
                             CHECK (granularity IN ('day', 'slots')),
  duration_days              INTEGER NOT NULL DEFAULT 1
                             CHECK (duration_days BETWEEN 1 AND 7),
  holiday_country            TEXT NOT NULL DEFAULT 'ES'
                             CHECK (holiday_country IN ('ES', 'MX', 'AR', 'CO', 'US', 'none')),
  required_participant_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_date             TEXT,
  confirmed_end_date         TEXT,
  confirmed_time             TEXT,
  confirmed_duration_minutes INTEGER NOT NULL DEFAULT 180,
  confirmed_timezone         TEXT,
  is_demo                    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Security & visibility (100% accountless)
  admin_token_hash           TEXT NOT NULL,
  visibility                 TEXT NOT NULL DEFAULT 'unlisted'
                             CHECK (visibility IN ('unlisted', 'public_demo')),

  -- Adaptive persistence / lifecycle
  retention_policy           TEXT NOT NULL DEFAULT 'ephemeral_after_event'
                             CHECK (retention_policy IN (
                               'ephemeral_after_event',
                               'fixed_ttl',
                               'sliding_inactivity',
                               'persistent'
                             )),
  retention_days             INTEGER NOT NULL DEFAULT 30,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                 TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS participants (
  id                   TEXT PRIMARY KEY,
  plan_id              TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  avatar_color         TEXT NOT NULL,
  avatar_emoji         TEXT NOT NULL,
  is_organizer         BOOLEAN NOT NULL DEFAULT FALSE,
  participant_token_hash TEXT NOT NULL,
  pin_hash             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique participant name per plan
CREATE UNIQUE INDEX IF NOT EXISTS uq_participants_plan_lower_name
  ON participants (plan_id, LOWER(name));

CREATE TABLE IF NOT EXISTS availabilities (
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  slot           TEXT NOT NULL DEFAULT 'all'
                 CHECK (slot IN ('all', 'morning', 'afternoon', 'evening')),
  status         TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  note           TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, participant_id, date, slot)
);

CREATE TABLE IF NOT EXISTS poll_options (
  plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  proposed_by TEXT REFERENCES participants(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, date)
);

CREATE TABLE IF NOT EXISTS votes (
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, participant_id, date)
);

CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date           TEXT,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rsvps (
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'not_going')),
  guests_count   INTEGER NOT NULL DEFAULT 0 CHECK (guests_count >= 0),
  note           TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, participant_id)
);

CREATE TABLE IF NOT EXISTS sub_polls (
  id               TEXT PRIMARY KEY,
  plan_id          TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  category         TEXT NOT NULL DEFAULT 'place'
                   CHECK (category IN ('place', 'activity', 'other')),
  question         TEXT NOT NULL,
  winner_option_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_poll_options (
  id             TEXT PRIMARY KEY,
  poll_id        TEXT NOT NULL REFERENCES sub_polls(id) ON DELETE CASCADE,
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL DEFAULT '',
  estimated_cost TEXT NOT NULL DEFAULT '',
  proposed_by    TEXT REFERENCES participants(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_poll_votes (
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  poll_id        TEXT NOT NULL REFERENCES sub_polls(id) ON DELETE CASCADE,
  option_id      TEXT NOT NULL REFERENCES sub_poll_options(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, option_id, participant_id)
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  assigned_to TEXT REFERENCES participants(id) ON DELETE SET NULL,
  completed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  TEXT REFERENCES participants(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carpool_rides (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  driver_id      TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  origin         TEXT NOT NULL,
  seats_total    INTEGER NOT NULL DEFAULT 3 CHECK (seats_total BETWEEN 1 AND 12),
  departure_time TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carpool_passengers (
  plan_id        TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  ride_id        TEXT NOT NULL REFERENCES carpool_rides(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ride_id, participant_id)
);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_participants_plan ON participants (plan_id);
CREATE INDEX IF NOT EXISTS idx_avail_plan ON availabilities (plan_id);
CREATE INDEX IF NOT EXISTS idx_votes_plan ON votes (plan_id);
CREATE INDEX IF NOT EXISTS idx_comments_plan_created ON comments (plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsvps_plan ON rsvps (plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_polls_plan ON sub_polls (plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_poll_options_poll ON sub_poll_options (poll_id);
CREATE INDEX IF NOT EXISTS idx_sub_poll_votes_poll ON sub_poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_checklist_plan ON checklist_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_carpool_plan ON carpool_rides (plan_id);
CREATE INDEX IF NOT EXISTS idx_carpool_passengers_ride ON carpool_passengers (ride_id);

-- Partial index for fast TTL expiration sweeps (ignores persistent plans)
CREATE INDEX IF NOT EXISTS idx_plans_expires_at
  ON plans (expires_at)
  WHERE expires_at IS NOT NULL AND is_demo = FALSE;
