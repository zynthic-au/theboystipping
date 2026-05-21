CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "joker_rounds" (
	"user_id" text NOT NULL,
	"round_id" uuid NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "joker_rounds_user_id_round_id_pk" PRIMARY KEY("user_id","round_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"home_team_code" text NOT NULL,
	"away_team_code" text NOT NULL,
	"winner_team_code" text,
	"starts_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" integer NOT NULL,
	"round_number" integer NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"closes_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tipping_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"join_code" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tipping_groups_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"match_id" uuid NOT NULL,
	"picked_team_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"full_name" text,
	"initials" text NOT NULL,
	"favourite_team_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_tipping_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tipping_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joker_rounds" ADD CONSTRAINT "joker_rounds_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joker_rounds" ADD CONSTRAINT "joker_rounds_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_code_teams_code_fk" FOREIGN KEY ("home_team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_code_teams_code_fk" FOREIGN KEY ("away_team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_code_teams_code_fk" FOREIGN KEY ("winner_team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipping_groups" ADD CONSTRAINT "tipping_groups_created_by_user_id_user_profiles_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_picked_team_code_teams_code_fk" FOREIGN KEY ("picked_team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_season_round_idx" ON "rounds" USING btree ("season","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tips_user_match_idx" ON "tips" USING btree ("user_id","match_id");