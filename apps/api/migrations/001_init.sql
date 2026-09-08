CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, username varchar(24) NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci ON users (lower(username));
CREATE TABLE IF NOT EXISTS challenges (
  id text PRIMARY KEY, name text NOT NULL, category text NOT NULL,
  description text NOT NULL, tier text NOT NULL, points integer NOT NULL CHECK(points > 0),
  delivery text NOT NULL CHECK(delivery IN ('http','tcp','static')),
  image text, port integer, artifact text, flag_hash text, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS challenge_instances (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  challenge_id text NOT NULL REFERENCES challenges(id),
  container_id text, network_id text, flag_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('starting','running','terminated','failed')),
  endpoint text NOT NULL, tcp_port integer, network_slot integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  terminated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_user ON challenge_instances(user_id) WHERE status IN ('starting','running');
CREATE UNIQUE INDEX IF NOT EXISTS unique_tcp_port ON challenge_instances(tcp_port) WHERE status IN ('starting','running');
CREATE UNIQUE INDEX IF NOT EXISTS unique_network_slot ON challenge_instances(network_slot) WHERE status IN ('starting','running');
CREATE INDEX IF NOT EXISTS instance_expiry ON challenge_instances(expires_at) WHERE status IN ('starting','running');
CREATE TABLE IF NOT EXISTS solves (
  user_id uuid NOT NULL REFERENCES users(id), challenge_id text NOT NULL REFERENCES challenges(id),
  points integer NOT NULL, first_blood boolean NOT NULL DEFAULT false,
  solved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, challenge_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_first_blood ON solves(challenge_id) WHERE first_blood;
