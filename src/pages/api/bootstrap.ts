import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";

import { getDb } from "../../db/client";
import { userProfiles } from "../../db/schema";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const user = body?.user;

    if (!user?.id) {
      return Response.json({ ok: false, error: "Missing user.id" }, { status: 400 });
    }

    const displayName = user.name || user.email?.split("@")[0] || "Tipper";
    const initials = getInitials(displayName);
    const db = getDb();

    await db.insert(userProfiles).values({
      userId: user.id,
      displayName,
      fullName: user.name || null,
      initials,
    }).onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        displayName,
        fullName: user.name || null,
        initials,
      },
    });

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id));

    return Response.json({ ok: true, profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Bootstrap failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}
