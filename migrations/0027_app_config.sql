-- M2.2 Step 1: single-user credentials storage. A generic app-level KV
-- table (DESIGN names the credential app_config.lan_password_hash) rather
-- than a dedicated credentials table — one row per config key, reusable
-- for later app-scoped values (server passphrase etc.). The Argon2id PHC
-- string self-describes its own params and salt
-- ($argon2id$v=19$m=...,t=...,p=...$salt$hash), so a single TEXT value
-- carries everything: no param columns, no hash-versioning column.
-- ABSENCE of the 'lan_password_hash' row = no password set. The
-- credentials ARE the gate's on/off switch (Allie 2026-08-07): Step 2
-- enforces only when the row exists; deleting it (settings panel later,
-- scripts/reset-password.mjs today) turns the gate off — so this table
-- deliberately has no separate enabled/disabled flag.
CREATE TABLE app_config (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
