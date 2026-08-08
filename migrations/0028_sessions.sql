-- M2.2 Step 2: per-device login sessions. Single user, so no user_id —
-- a row IS "some device is logged in". The cookie carries a random
-- 256-bit token; only its SHA-256 hex is stored here, so a leaked DB
-- never yields a usable cookie. Absence of a row = logged out.
-- Lifetime is sliding (~90 days, renewed in the validate path when
-- under 45 remain) — "log in once per device". Expired rows are swept
-- at boot (purgeExpiredSessions, db.ts tail) as housekeeping only; the
-- lookup predicate expires_at > datetime('now') is the real boundary.
-- Invalidation rules (the switch model): password change deletes ALL
-- rows then re-issues one to the changing device; password remove and
-- scripts/reset-password.mjs delete ALL rows (gate off).
CREATE TABLE sessions (
	id           TEXT PRIMARY KEY,
	created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_seen_at DATETIME,
	expires_at   DATETIME NOT NULL,
	user_agent   TEXT
);
