import type { APIRoute } from "astro";
import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "../../db/client";
import {
  groupMembers,
  jokerRounds,
  matches,
  rounds,
  teams,
  tippingGroups,
  tips,
  userProfiles,
} from "../../db/schema";

export const prerender = false;

const SHARED_STATE_TTL_MS = 60_000;

type Db = ReturnType<typeof getDb>;
type AppRound = {
  id: string;
  n: number;
  label: string;
  status: string;
  closes: string;
  closesAt: string | null;
  matches: {
    id: string;
    home: string;
    away: string;
    result: string | null;
    time: string;
  }[];
};
type SharedState = {
  teams: (typeof teams.$inferSelect)[];
  rounds: AppRound[];
  currentRound: number | null;
};

let sharedStateCache: { expiresAt: number; value: SharedState } | null = null;
let sharedStateLoad: Promise<SharedState> | null = null;

export const GET: APIRoute = async ({ url }) => {
  try {
    const userId = url.searchParams.get("userId");
    const db = getDb();
    const sharedState = await getSharedState(db);

    if (!userId) {
      return Response.json({
        ok: true,
        profile: null,
        teams: sharedState.teams,
        rounds: sharedState.rounds,
        groups: [],
        members: [],
        picks: {},
        jokerRounds: [],
        currentRound: sharedState.currentRound,
      }, {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      });
    }

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));

    const memberGroupRows = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));

    const groupIds = memberGroupRows.map((row) => row.groupId);
    const groupRows = groupIds.length
      ? await db.select().from(tippingGroups).where(inArray(tippingGroups.id, groupIds)).orderBy(asc(tippingGroups.name))
      : [];

    const allMembershipRows = groupIds.length
      ? await db
          .select({
            groupId: groupMembers.groupId,
            userId: groupMembers.userId,
            joinedAt: groupMembers.joinedAt,
            displayName: userProfiles.displayName,
            fullName: userProfiles.fullName,
            initials: userProfiles.initials,
            favouriteTeamCode: userProfiles.favouriteTeamCode,
          })
          .from(groupMembers)
          .innerJoin(userProfiles, eq(groupMembers.userId, userProfiles.userId))
          .where(inArray(groupMembers.groupId, groupIds))
      : [];

    const memberIds = Array.from(new Set([userId, ...allMembershipRows.map((row) => row.userId)]));

    const tipRows = memberIds.length
      ? await db
          .select({
            userId: tips.userId,
            roundNumber: rounds.roundNumber,
            matchExternalId: matches.externalId,
            matchId: matches.id,
            pickedTeamCode: tips.pickedTeamCode,
          })
          .from(tips)
          .innerJoin(matches, eq(tips.matchId, matches.id))
          .innerJoin(rounds, eq(matches.roundId, rounds.id))
          .where(inArray(tips.userId, memberIds))
      : [];

    const jokerRows = memberIds.length
      ? await db
          .select({
            userId: jokerRounds.userId,
            roundNumber: rounds.roundNumber,
            isLocked: jokerRounds.isLocked,
          })
          .from(jokerRounds)
          .innerJoin(rounds, eq(jokerRounds.roundId, rounds.id))
          .where(inArray(jokerRounds.userId, memberIds))
      : [];

    const picks = tipRows.reduce<Record<number, Record<string, { picks: Record<string, string>; joker?: boolean }>>>(
      (acc, row) => {
        const roundPicks = acc[row.roundNumber] ??= {};
        const userPicks = roundPicks[row.userId] ??= { picks: {} };
        userPicks.picks[row.matchExternalId || row.matchId] = row.pickedTeamCode;
        userPicks.joker = jokerRows.some(
          (joker) => joker.userId === row.userId && joker.roundNumber === row.roundNumber,
        );
        return acc;
      },
      {},
    );

    const membersById = new Map<string, {
      id: string;
      name: string;
      fullName: string;
      team: string | null;
      joined: string;
      initials: string;
      you: boolean;
    }>();

    for (const row of allMembershipRows) {
      membersById.set(row.userId, {
        id: row.userId,
        name: row.displayName,
        fullName: row.fullName || row.displayName,
        team: row.favouriteTeamCode,
        joined: formatDate(row.joinedAt),
        initials: row.initials,
        you: row.userId === userId,
      });
    }

    if (profile && !membersById.has(userId)) {
      membersById.set(userId, {
        id: userId,
        name: profile.displayName,
        fullName: profile.fullName || profile.displayName,
        team: profile.favouriteTeamCode,
        joined: formatDate(profile.createdAt),
        initials: profile.initials,
        you: true,
      });
    }

    const groups = groupRows.map((group) => {
      const groupMemberRows = allMembershipRows.filter((row) => row.groupId === group.id);

      return {
        id: group.id,
        name: group.name,
        tag: `Created ${formatDate(group.createdAt)}`,
        joinCode: group.joinCode,
        memberIds: groupMemberRows.map((row) => row.userId),
        description: group.description || "",
        members: groupMemberRows.length,
      };
    });

    return Response.json({
      ok: true,
      profile,
      teams: sharedState.teams,
      rounds: sharedState.rounds,
      groups,
      members: Array.from(membersById.values()),
      picks,
      jokerRounds: jokerRows
        .filter((row) => row.userId === userId)
        .map((row) => ({ roundNumber: row.roundNumber, isLocked: row.isLocked })),
      currentRound: sharedState.currentRound,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load app state" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

async function getSharedState(db: Db) {
  const now = Date.now();
  if (sharedStateCache && sharedStateCache.expiresAt > now) return sharedStateCache.value;

  sharedStateLoad ??= loadSharedState(db).then((value) => {
    sharedStateCache = { value, expiresAt: Date.now() + SHARED_STATE_TTL_MS };
    return value;
  }).finally(() => {
    sharedStateLoad = null;
  });

  return sharedStateLoad;
}

async function loadSharedState(db: Db): Promise<SharedState> {
  const [teamRows, roundRows, matchRows] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.name)),
    db.select().from(rounds).orderBy(asc(rounds.roundNumber)),
    db.select().from(matches).orderBy(asc(matches.sortOrder)),
  ]);

  const appRounds = roundRows.map((round) => ({
    id: round.id,
    n: round.roundNumber,
    label: round.label,
    status: round.status,
    closes: formatDateTime(round.closesAt),
    closesAt: round.closesAt?.toISOString() ?? null,
    matches: matchRows
      .filter((match) => match.roundId === round.id)
      .map((match) => ({
        id: match.externalId || match.id,
        home: match.homeTeamCode,
        away: match.awayTeamCode,
        result: match.winnerTeamCode,
        time: formatMatchTime(match.startsAt),
      })),
  }));

  return {
    teams: teamRows,
    rounds: appRounds,
    currentRound:
      appRounds.find((round) => round.status === "open")?.n ??
      appRounds.find((round) => round.status === "upcoming")?.n ??
      appRounds.at(-1)?.n ??
      null,
  };
}

function formatDateTime(value: Date | null) {
  if (!value) return "Not scheduled";

  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatMatchTime(value: Date | null) {
  if (!value) return "TBC";

  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
