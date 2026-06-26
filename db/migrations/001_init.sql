-- שערי רווחה - schema ראשוני
CREATE SCHEMA IF NOT EXISTS shaare_revaha;

CREATE TABLE shaare_revaha.bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,
  date          DATE NOT NULL,
  ride_id       SMALLINT NOT NULL CHECK (ride_id BETWEEN 1 AND 8),
  neighborhood  CHAR(1) NOT NULL CHECK (neighborhood IN ('A','B')),
  station       SMALLINT NOT NULL CHECK (station BETWEEN 1 AND 12),
  seats_count   SMALLINT NOT NULL DEFAULT 1 CHECK (seats_count BETWEEN 1 AND 3),
  booking_code  CHAR(4) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMPTZ
);

-- אינדקסים
CREATE INDEX ON shaare_revaha.bookings (date, ride_id, status);
CREATE INDEX ON shaare_revaha.bookings (phone, date);
CREATE INDEX ON shaare_revaha.bookings (date);
-- קוד הזמנה ייחודי לכל יום
CREATE UNIQUE INDEX ON shaare_revaha.bookings (date, booking_code);
