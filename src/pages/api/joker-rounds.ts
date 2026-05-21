import type { APIRoute } from "astro";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../../db/client";
import { jokerRounds, rounds } from "../../db/schema";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId, roundNumber } = await request.json();
    if (!userId) return Response.json({ ok: false, error: "Missing userId" }, { status: 400, headers: { "Cache-Control": "no-store" } });

    const db = getDb();

    if (roundNumber == null) {
      await db.delete(jokerRounds).where(and(eq(jokerRounds.userId, userId), eq(jokerRounds.isLocked, false)));
      return Response.json({ ok: true, jokerRound: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const [round] = await db
      .select({ id: rounds.id, roundNumber: rounds.roundNumber })
      .from(rounds)
      .where(eq(rounds.roundNumber, Number(roundNumber)))
      .orderBy(desc(rounds.season))
      .limit(1);

    if (!round) return Response.json({ ok: false, error: `Unknown round ${roundNumber}` }, { status: 404, headers: { "Cache-Control": "no-store" } });

    await db.delete(jokerRounds).where(and(eq(jokerRounds.userId, userId), eq(jokerRounds.isLocked, false)));
    await db.insert(jokerRounds).values({ userId, roundId: round.id }).onConflictDoNothing();

    return Response.json({ ok: true, jokerRound: round.roundNumber }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save joker round" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
