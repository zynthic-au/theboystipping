import type { APIRoute } from "astro";
import { asc, eq } from "drizzle-orm";

import { getDb } from "../../db/client";
import { groupMembers, tippingGroups, userProfiles } from "../../db/schema";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const db = getDb();
    const groups = await db.select().from(tippingGroups).orderBy(asc(tippingGroups.name));

    return Response.json({ ok: true, groups }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, user, userId, name, description, joinCode } = await request.json();

    if (!userId) {
      return Response.json({ ok: false, error: "Missing userId" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const db = getDb();
    await ensureUserProfile(db, user || { id: userId });

    if (action === "create") {
      const trimmedName = String(name || "").trim();
      if (!trimmedName) {
        return Response.json({ ok: false, error: "Missing group name" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }

      const [group] = await db.insert(tippingGroups).values({
        name: trimmedName,
        description: String(description || "").trim() || null,
        joinCode: await getUniqueJoinCode(db),
        createdByUserId: userId,
      }).returning();

      await db.insert(groupMembers).values({ groupId: group.id, userId }).onConflictDoNothing();

      return Response.json({ ok: true, group }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "join") {
      const normalizedJoinCode = String(joinCode || "").trim().toUpperCase();
      if (!normalizedJoinCode) {
        return Response.json({ ok: false, error: "Missing join code" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }

      const [group] = await db
        .select()
        .from(tippingGroups)
        .where(eq(tippingGroups.joinCode, normalizedJoinCode));

      if (!group) {
        return Response.json({ ok: false, error: "Group not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }

      await db.insert(groupMembers).values({ groupId: group.id, userId }).onConflictDoNothing();

      return Response.json({ ok: true, group }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ ok: false, error: "Unknown group action" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

async function getUniqueJoinCode(db: ReturnType<typeof getDb>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const existing = await db
      .select({ id: tippingGroups.id })
      .from(tippingGroups)
      .where(eq(tippingGroups.joinCode, code));

    if (!existing.length) return code;
  }

  throw new Error("Could not generate a unique join code");
}

async function ensureUserProfile(db: ReturnType<typeof getDb>, user: { id?: string; name?: string | null; email?: string | null }) {
  if (!user.id) throw new Error("Missing user.id");

  const displayName = user.name || user.email?.split("@")[0] || "Tipper";
  const initials = getInitials(displayName);

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
      updatedAt: new Date(),
    },
  });
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}
