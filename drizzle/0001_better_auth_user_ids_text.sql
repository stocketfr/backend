-- stocket:previous-app-compatible=false
DO $$
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    RETURN;
  END IF;

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
