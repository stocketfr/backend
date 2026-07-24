-- stocket:previous-app-compatible=false
-- 0004: Repair better-auth id columns that 0001 left as uuid.
--
-- 0001 converts "user".id (and the session/account/invitation columns that
-- reference it) from uuid to text. But 0001 opens with an `IF user table IS NULL
-- THEN RETURN` guard, and the committed-migration runner records a migration as
-- applied whenever its SQL executes without error -- including a DO block that
-- hits that guard and no-ops. On long-lived dev databases where the better-auth
-- "user" table did not exist yet when 0001 first ran, 0001 was marked applied
-- without converting anything and never self-heals. Those databases are left
-- with "user".id = uuid while app-owned columns like user_roles.user_id are
-- text, so any query that JOINs user_roles back to "user" fails with
-- `operator does not exist: text = uuid` (notifications audience resolution).
--
-- This migration re-applies the conversion idempotently: it only rewrites columns
-- that are still uuid, so it is a no-op on databases already on text ids.

DO $$
DECLARE
  needs_column_type_repair boolean;
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS locale text;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'user' AND column_name = 'id')
        OR (table_name = 'account' AND column_name = 'user_id')
        OR (table_name = 'session' AND column_name = 'user_id')
        OR (table_name = 'invitation' AND column_name = 'inviter_id')
      )
      AND data_type <> 'text'
  ) INTO needs_column_type_repair;

  IF needs_column_type_repair THEN
    ALTER TABLE IF EXISTS "account" DROP CONSTRAINT IF EXISTS account_user_id_fkey;
    ALTER TABLE IF EXISTS "session" DROP CONSTRAINT IF EXISTS session_user_id_fkey;
    ALTER TABLE IF EXISTS "invitation" DROP CONSTRAINT IF EXISTS invitation_inviter_id_fkey;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user'
        AND column_name = 'id'
        AND data_type <> 'text'
    ) THEN
      ALTER TABLE "user" ALTER COLUMN id TYPE text USING id::text;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'account'
        AND column_name = 'user_id'
        AND data_type <> 'text'
    ) THEN
      ALTER TABLE "account" ALTER COLUMN user_id TYPE text USING user_id::text;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'session'
        AND column_name = 'user_id'
        AND data_type <> 'text'
    ) THEN
      ALTER TABLE "session" ALTER COLUMN user_id TYPE text USING user_id::text;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'invitation'
        AND column_name = 'inviter_id'
        AND data_type <> 'text'
    ) THEN
      ALTER TABLE "invitation" ALTER COLUMN inviter_id TYPE text USING inviter_id::text;
    END IF;
  END IF;

  IF to_regclass('public."account"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'account'
        AND constraint_name = 'account_user_id_fkey'
    ) THEN
    ALTER TABLE "account"
      ADD CONSTRAINT account_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public."session"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'session'
        AND constraint_name = 'session_user_id_fkey'
    ) THEN
    ALTER TABLE "session"
      ADD CONSTRAINT session_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public."invitation"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'invitation'
        AND constraint_name = 'invitation_inviter_id_fkey'
    ) THEN
    ALTER TABLE "invitation"
      ADD CONSTRAINT invitation_inviter_id_fkey
      FOREIGN KEY (inviter_id) REFERENCES "user"(id) ON DELETE CASCADE;
  END IF;
END $$;
