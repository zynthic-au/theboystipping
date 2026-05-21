import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userProfiles = pgTable("user_profiles", {
  // Stores neon_auth.user.id. Neon Auth owns the neon_auth schema, so this app
  // keeps a profile row keyed by the auth user id instead of managing auth users.
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  fullName: text("full_name"),
  initials: text("initials").notNull(),
  favouriteTeamCode: text("favourite_team_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
});

export const rounds = pgTable("rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundKey: text("round_key"),
  season: integer("season").notNull(),
  roundNumber: integer("round_number").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("upcoming"),
  closesAt: timestamp("closes_at", { withTimezone: true }),
}, (table) => ({
  seasonRoundIdx: uniqueIndex("rounds_season_round_idx").on(table.season, table.roundNumber),
  roundKeyIdx: uniqueIndex("rounds_round_key_idx").on(table.roundKey),
}));

export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalId: text("external_id"),
  roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
  homeTeamCode: text("home_team_code").notNull().references(() => teams.code),
  awayTeamCode: text("away_team_code").notNull().references(() => teams.code),
  winnerTeamCode: text("winner_team_code").references(() => teams.code),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => ({
  externalIdIdx: uniqueIndex("matches_external_id_idx").on(table.externalId),
}));

export const tippingGroups = pgTable("tipping_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  joinCode: text("join_code").notNull().unique(),
  createdByUserId: text("created_by_user_id").references(() => userProfiles.userId),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const groupMembers = pgTable("group_members", {
  groupId: uuid("group_id").notNull().references(() => tippingGroups.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.groupId, table.userId] }),
}));

export const tips = pgTable("tips", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  pickedTeamCode: text("picked_team_code").notNull().references(() => teams.code),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userMatchIdx: uniqueIndex("tips_user_match_idx").on(table.userId, table.matchId),
}));

export const jokerRounds = pgTable("joker_rounds", {
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roundId] }),
}));

export const userProfilesRelations = relations(userProfiles, ({ many }) => ({
  memberships: many(groupMembers),
  tips: many(tips),
  jokerRounds: many(jokerRounds),
}));

export const groupsRelations = relations(tippingGroups, ({ many }) => ({
  members: many(groupMembers),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(tippingGroups, {
    fields: [groupMembers.groupId],
    references: [tippingGroups.id],
  }),
  user: one(userProfiles, {
    fields: [groupMembers.userId],
    references: [userProfiles.userId],
  }),
}));

export const roundsRelations = relations(rounds, ({ many }) => ({
  matches: many(matches),
  jokerRounds: many(jokerRounds),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  round: one(rounds, {
    fields: [matches.roundId],
    references: [rounds.id],
  }),
  tips: many(tips),
}));

export const tipsRelations = relations(tips, ({ one }) => ({
  user: one(userProfiles, {
    fields: [tips.userId],
    references: [userProfiles.userId],
  }),
  match: one(matches, {
    fields: [tips.matchId],
    references: [matches.id],
  }),
}));

export const jokerRoundsRelations = relations(jokerRounds, ({ one }) => ({
  user: one(userProfiles, {
    fields: [jokerRounds.userId],
    references: [userProfiles.userId],
  }),
  round: one(rounds, {
    fields: [jokerRounds.roundId],
    references: [rounds.id],
  }),
}));

export const now = sql`now()`;
