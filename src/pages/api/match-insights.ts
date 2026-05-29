import type { APIRoute } from "astro";

import { getMatchInsights, getMatchInsightsBatch } from "../../lib/match-insights";
import { matchupKey } from "../../lib/nrl-teams";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const matchupsParam = url.searchParams.get("matchups");
    const home = url.searchParams.get("home");
    const away = url.searchParams.get("away");

    if (matchupsParam) {
      const matchups = matchupsParam
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [homeCode, awayCode] = item.split(":");
          return { home: homeCode, away: awayCode };
        })
        .filter((item) => item.home && item.away);

      const insights = await getMatchInsightsBatch(matchups);
      return Response.json({ ok: true, insights }, {
        headers: { "Cache-Control": "public, max-age=14400, stale-while-revalidate=14400" },
      });
    }

    if (!home || !away) {
      return Response.json({ ok: false, error: "Provide home and away, or matchups=BRI:STO,..." }, { status: 400 });
    }

    const insight = await getMatchInsights(home, away);
    return Response.json({
      ok: true,
      key: matchupKey(home, away),
      insight,
    }, {
      headers: { "Cache-Control": "public, max-age=14400, stale-while-revalidate=14400" },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load match insights" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
