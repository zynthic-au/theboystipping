ALTER TABLE "group_members" DROP CONSTRAINT IF EXISTS "group_members_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "joker_rounds" DROP CONSTRAINT IF EXISTS "joker_rounds_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tipping_groups" DROP CONSTRAINT IF EXISTS "tipping_groups_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tips" DROP CONSTRAINT IF EXISTS "tips_user_id_users_id_fk";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL AND to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE "users" RENAME TO "user_profiles";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'id'
  ) THEN
    ALTER TABLE "user_profiles" RENAME COLUMN "id" TO "user_id";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "group_members" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "joker_rounds" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "tipping_groups" ALTER COLUMN "created_by_user_id" TYPE text USING "created_by_user_id"::text;--> statement-breakpoint
ALTER TABLE "tips" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joker_rounds" ADD CONSTRAINT "joker_rounds_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipping_groups" ADD CONSTRAINT "tipping_groups_created_by_user_id_user_profiles_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "external_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "round_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "matches_external_id_idx" ON "matches" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rounds_round_key_idx" ON "rounds" USING btree ("round_key");
