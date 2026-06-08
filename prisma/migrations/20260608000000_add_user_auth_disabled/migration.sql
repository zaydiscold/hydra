-- AddColumn
-- Backfills the User.authDisabled column for the unified disable-auth feature.
-- Without this migration, packaged upgrades-in-place never gain the column
-- (db-self-heal.js replays migration SQL; `prisma db push` is dev-only), so the
-- rotation pool loads 0 keys and auth queries fail with
-- "column main.User.authDisabled does not exist".
ALTER TABLE "User" ADD COLUMN "authDisabled" BOOLEAN NOT NULL DEFAULT false;
