import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () => {
  const authUrl = import.meta.env.PUBLIC_NEON_AUTH_URL;

  if (!authUrl) {
    return Response.json({
      ok: false,
      configured: false,
      message: "PUBLIC_NEON_AUTH_URL is missing",
    });
  }

  try {
    const url = new URL(authUrl);
    return Response.json({
      ok: true,
      configured: true,
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
      expectedPathHint: "Usually /neondb/auth",
      endsWithAuth: url.pathname.endsWith("/auth"),
    });
  } catch {
    return Response.json(
      {
        ok: false,
        configured: true,
        message: "PUBLIC_NEON_AUTH_URL is not a valid URL",
      },
      { status: 500 },
    );
  }
};
