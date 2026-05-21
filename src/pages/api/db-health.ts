import type { APIRoute } from "astro";
import { sql } from "drizzle-orm";

import { getDb } from "../../db/client";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const db = getDb();
    const result = await db.execute(sql`select now() as now`);

    return Response.json({
      ok: true,
      database: "neon",
      now: result.rows[0]?.now ?? null,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 500 },
    );
  }
};
