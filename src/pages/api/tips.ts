import type { APIRoute } from "astro";
import { eq, or } from "drizzle-orm";

import { getDb } from "../../db/client";
import { jokerRounds, matches, rounds, tips } from "../../db/schema";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const userId = url.searchParams.get("userId");
    if (!userId) return Response.json({ ok: false, error: "Missing userId" }, { status: 400, headers: { "Cache-Control": "no-store" } });

    const db = getDb();
    const rows = await db
      .select({
        matchExternalId: matches.externalId,
        pickedTeamCode: tips.pickedTeamCode,
      })
      .from(tips)
      .innerJoin(matches, eq(tips.matchId, matches.id))
      .where(eq(tips.userId, userId));

    const jokerRows = await db
      .select({ roundNumber: rounds.roundNumber })
      .from(jokerRounds)
      .innerJoin(rounds, eq(jokerRounds.roundId, rounds.id))
      .where(eq(jokerRounds.userId, userId));

    return Response.json(
      { ok: true, tips: rows, jokerRounds: jokerRows.map((row) => row.roundNumber) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load tips" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId, matchExternalId, pickedTeamCode } = await request.json();
    if (!userId || !matchExternalId || !pickedTeamCode) {
      return Response.json({ ok: false, error: "Missing userId, matchExternalId, or pickedTeamCode" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const matchKey = String(matchExternalId);
    const db = getDb();
    const matchWhere = isUuid(matchKey)
      ? or(eq(matches.externalId, matchKey), eq(matches.id, matchKey))
      : eq(matches.externalId, matchKey);

    const [match] = await db
      .select({ id: matches.id })
      .from(matches)
      .where(matchWhere);
    if (!match) return Response.json({ ok: false, error: `Unknown match ${matchKey}` }, { status: 404, headers: { "Cache-Control": "no-store" } });

    const [savedTip] = await db.insert(tips).values({
      userId,
      matchId: match.id,
      pickedTeamCode,
    }).onConflictDoUpdate({
      target: [tips.userId, tips.matchId],
      set: {
        pickedTeamCode,
        updatedAt: new Date(),
      },
    }).returning();

    return Response.json({ ok: true, tip: savedTip }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save tip" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
