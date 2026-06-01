-- PixelMania PostgreSQL foundation schema
-- Focus: integrity, anti-dupe, auditability, rollback readiness

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS pixelmania;
SET search_path TO pixelmania, public;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS accounts (
	account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	username citext NOT NULL UNIQUE,
	email citext NOT NULL UNIQUE,
	password_salt text NOT NULL DEFAULT '',
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin', 'owner')),
	is_active boolean NOT NULL DEFAULT true,
	last_login_at timestamptz,
	email_verified boolean NOT NULL DEFAULT false,
	email_verified_at timestamptz,
	email_verification_token_hash text NOT NULL DEFAULT '',
	email_verification_expires_at timestamptz,
	account_state jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
	player_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL UNIQUE REFERENCES accounts(account_id) ON DELETE CASCADE,
	display_name text NOT NULL,
	player_health integer NOT NULL DEFAULT 100 CHECK (player_health >= 0),
	player_level integer NOT NULL DEFAULT 1 CHECK (player_level BETWEEN 1 AND 100),
	player_xp bigint NOT NULL DEFAULT 0 CHECK (player_xp >= 0),
	player_xp_needed bigint NOT NULL DEFAULT 100 CHECK (player_xp_needed >= 0),
	player_total_xp bigint NOT NULL DEFAULT 0 CHECK (player_total_xp >= 0),
	player_title text NOT NULL DEFAULT 'Explorer',
	last_level_up_at timestamptz,
	current_world_name text,
	player_state jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
	session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
	session_token_hash text NOT NULL UNIQUE,
	ip_address inet,
	user_agent text,
	issued_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at ON sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS worlds (
	world_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	world_name citext NOT NULL UNIQUE,
	owner_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	width integer NOT NULL DEFAULT 400 CHECK (width > 0),
	height integer NOT NULL DEFAULT 100 CHECK (height > 0),
	world_data_version integer NOT NULL DEFAULT 1 CHECK (world_data_version > 0),
	last_loaded_at timestamptz,
	last_saved_at timestamptz,
	is_active boolean NOT NULL DEFAULT true,
	world_checksum text,
	world_state jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS password_salt text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
ADD COLUMN IF NOT EXISTS email_verification_token_hash text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
ADD COLUMN IF NOT EXISTS account_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE players
ADD COLUMN IF NOT EXISTS current_world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL;

ALTER TABLE players
ADD COLUMN IF NOT EXISTS player_level integer NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS player_xp bigint NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS player_xp_needed bigint NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS player_total_xp bigint NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS player_title text NOT NULL DEFAULT 'Explorer',
ADD COLUMN IF NOT EXISTS last_level_up_at timestamptz,
ADD COLUMN IF NOT EXISTS player_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE worlds
ADD COLUMN IF NOT EXISTS world_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS player_progression_events (
	player_progression_event_id bigserial PRIMARY KEY,
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	source text NOT NULL,
	xp_delta bigint NOT NULL CHECK (xp_delta >= 0),
	level_before integer NOT NULL CHECK (level_before BETWEEN 1 AND 100),
	level_after integer NOT NULL CHECK (level_after BETWEEN 1 AND 100),
	xp_before bigint NOT NULL CHECK (xp_before >= 0),
	xp_after bigint NOT NULL CHECK (xp_after >= 0),
	total_xp_after bigint NOT NULL CHECK (total_xp_after >= 0),
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_progression_events_player_time
ON player_progression_events(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_members (
	world_id uuid NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'builder', 'member', 'banned')),
	granted_by_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (world_id, player_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_world_owner_member
ON world_members(world_id)
WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS world_lock_access (
	world_id uuid NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	granted_by_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	can_build boolean NOT NULL DEFAULT true,
	can_break boolean NOT NULL DEFAULT true,
	can_manage_vending boolean NOT NULL DEFAULT false,
	can_manage_lock boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (world_id, player_id)
);

CREATE TABLE IF NOT EXISTS world_locks (
	world_lock_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	world_id uuid NOT NULL UNIQUE REFERENCES worlds(world_id) ON DELETE CASCADE,
	lock_type text NOT NULL DEFAULT 'none' CHECK (lock_type IN ('none', 'world_lock', 'diamond_lock')),
	owner_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	is_locked boolean NOT NULL DEFAULT false,
	lock_x integer,
	lock_y integer,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	item_type text NOT NULL,
	item_category text NOT NULL,
	amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
	stack_limit bigint NOT NULL DEFAULT 200 CHECK (stack_limit > 0),
	row_version bigint NOT NULL DEFAULT 0,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (player_id, item_type, item_category)
);

CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory(item_type, item_category);

CREATE TABLE IF NOT EXISTS idempotency_keys (
	idempotency_key_id bigserial PRIMARY KEY,
	scope text NOT NULL,
	key text NOT NULL,
	player_id uuid REFERENCES players(player_id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	UNIQUE (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_player_scope ON idempotency_keys(player_id, scope);

CREATE TABLE IF NOT EXISTS item_transactions (
	item_transaction_id bigserial PRIMARY KEY,
	tx_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL,
	source text NOT NULL CHECK (
		source IN (
			'world_block_break',
			'drop_pickup',
			'drop_inventory',
			'seed_place',
			'seed_splice',
			'seed_harvest',
			'trade',
			'vending',
			'shop',
			'craft',
			'furnace',
			'fishing',
			'fish_monger',
			'admin',
			'system'
		)
	),
	action text NOT NULL,
	item_type text,
	item_category text,
	delta bigint NOT NULL,
	before_amount bigint,
	after_amount bigint,
	request_id text,
	correlation_id uuid,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (after_amount IS NULL OR after_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_item_transactions_player_time
ON item_transactions(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_transactions_world_time
ON item_transactions(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_transactions_request_id
ON item_transactions(request_id)
WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_transactions_correlation_id
ON item_transactions(correlation_id)
WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gem_ledger (
	gem_ledger_id bigserial PRIMARY KEY,
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	delta bigint NOT NULL,
	reason text NOT NULL,
	ref_type text,
	ref_id text,
	before_balance bigint,
	after_balance bigint,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (after_balance IS NULL OR after_balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_gem_ledger_player_time
ON gem_ledger(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS item_instances (
	item_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	item_type text NOT NULL,
	item_category text NOT NULL,
	owner_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL,
	state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'consumed', 'traded', 'destroyed', 'dropped', 'locked')),
	origin_transaction_id bigint REFERENCES item_transactions(item_transaction_id) ON DELETE SET NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_instances_owner ON item_instances(owner_player_id, state);
CREATE INDEX IF NOT EXISTS idx_item_instances_world ON item_instances(world_id, state);

CREATE TABLE IF NOT EXISTS trades (
	trade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL,
	player_a_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	player_b_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	initiated_by_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'accepted', 'completed', 'canceled', 'expired', 'rejected')),
	cancel_reason text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_trades_players_time
ON trades(player_a_id, player_b_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status_time
ON trades(status, created_at DESC);

CREATE TABLE IF NOT EXISTS trade_items (
	trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
	from_player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	slot_index integer NOT NULL CHECK (slot_index >= 0),
	item_type text NOT NULL,
	item_category text NOT NULL,
	amount bigint NOT NULL CHECK (amount > 0),
	PRIMARY KEY (trade_id, from_player_id, slot_index)
);

CREATE TABLE IF NOT EXISTS vending_transactions (
	vending_transaction_id bigserial PRIMARY KEY,
	tx_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	world_id uuid NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
	vend_owner_player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	buyer_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	block_x integer NOT NULL,
	block_y integer NOT NULL,
	item_type text NOT NULL,
	item_category text NOT NULL,
	amount bigint NOT NULL CHECK (amount > 0),
	price_gems bigint NOT NULL CHECK (price_gems >= 0),
	total_gems bigint NOT NULL CHECK (total_gems >= 0),
	request_id text,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vending_transactions_world_time
ON vending_transactions(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vending_transactions_owner_time
ON vending_transactions(vend_owner_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vending_transactions_buyer_time
ON vending_transactions(buyer_player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_purchases (
	shop_purchase_id bigserial PRIMARY KEY,
	tx_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	shop_id text NOT NULL,
	item_type text NOT NULL,
	item_category text NOT NULL,
	amount bigint NOT NULL CHECK (amount > 0),
	price_currency_type text NOT NULL,
	price_amount bigint NOT NULL CHECK (price_amount >= 0),
	request_id text,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_purchases_player_time
ON shop_purchases(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_actions (
	admin_action_id bigserial PRIMARY KEY,
	admin_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	action_type text NOT NULL,
	target_type text NOT NULL,
	target_id text,
	world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL,
	request_id text,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_time
ON admin_actions(admin_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_world_time
ON admin_actions(world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_block_changes (
	world_block_change_id bigserial PRIMARY KEY,
	world_id uuid NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
	player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	action text NOT NULL CHECK (action IN ('place', 'break', 'hit')),
	layer text NOT NULL CHECK (layer IN ('foreground', 'background')),
	block_x integer NOT NULL,
	block_y integer NOT NULL,
	block_type_before text,
	block_type_after text,
	hit_count integer,
	tx_uuid uuid,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_block_changes_world_time
ON world_block_changes(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_block_changes_world_position
ON world_block_changes(world_id, block_x, block_y, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_block_changes_player_time
ON world_block_changes(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_snapshots (
	world_snapshot_id bigserial PRIMARY KEY,
	world_id uuid NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
	snapshot_version integer NOT NULL CHECK (snapshot_version > 0),
	checksum text,
	storage_uri text,
	snapshot_data jsonb,
	reason text NOT NULL DEFAULT 'snapshot',
	created_by text NOT NULL DEFAULT 'system',
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (world_id, snapshot_version)
);

CREATE INDEX IF NOT EXISTS idx_world_snapshots_world_time
ON world_snapshots(world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
	security_event_id bigserial PRIMARY KEY,
	account_id uuid REFERENCES accounts(account_id) ON DELETE SET NULL,
	player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	world_id uuid REFERENCES worlds(world_id) ON DELETE SET NULL,
	session_id uuid REFERENCES sessions(session_id) ON DELETE SET NULL,
	severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
	event_type text NOT NULL,
	request_id text,
	ip_address inet,
	details jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_time
ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_account_time
ON security_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_player_time
ON security_events(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_world_time
ON security_events(world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS punishments (
	punishment_id bigserial PRIMARY KEY,
	player_id uuid NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
	issued_by_player_id uuid REFERENCES players(player_id) ON DELETE SET NULL,
	punishment_type text NOT NULL CHECK (punishment_type IN ('ban', 'mute', 'trade_ban', 'world_ban', 'lockout')),
	reason text NOT NULL,
	scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'world')),
	world_id uuid REFERENCES worlds(world_id) ON DELETE CASCADE,
	starts_at timestamptz NOT NULL DEFAULT now(),
	ends_at timestamptz,
	is_active boolean NOT NULL DEFAULT true,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (scope = 'global' OR world_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_punishments_player_active
ON punishments(player_id, is_active, ends_at);

DROP TRIGGER IF EXISTS trg_accounts_set_updated_at ON accounts;
CREATE TRIGGER trg_accounts_set_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_players_set_updated_at ON players;
CREATE TRIGGER trg_players_set_updated_at
BEFORE UPDATE ON players
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_worlds_set_updated_at ON worlds;
CREATE TRIGGER trg_worlds_set_updated_at
BEFORE UPDATE ON worlds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_world_lock_access_set_updated_at ON world_lock_access;
CREATE TRIGGER trg_world_lock_access_set_updated_at
BEFORE UPDATE ON world_lock_access
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_world_locks_set_updated_at ON world_locks;
CREATE TRIGGER trg_world_locks_set_updated_at
BEFORE UPDATE ON world_locks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_set_updated_at ON inventory;
CREATE TRIGGER trg_inventory_set_updated_at
BEFORE UPDATE ON inventory
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_item_instances_set_updated_at ON item_instances;
CREATE TRIGGER trg_item_instances_set_updated_at
BEFORE UPDATE ON item_instances
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_trades_set_updated_at ON trades;
CREATE TRIGGER trg_trades_set_updated_at
BEFORE UPDATE ON trades
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
