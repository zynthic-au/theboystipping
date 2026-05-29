import {
  getAuthClient,
  getDisplayName,
  getInitials,
  hasAuthConfig,
  readCachedAuthUser,
  writeCachedAuthUser,
  type CachedAuthUser,
} from "./auth-client";

const protectedPathPrefixes = ["/tips", "/groups"];
const pathname = window.location.pathname;
const SESSION_RETRIES = 4;
const SESSION_RETRY_MS = 100;

type SessionUser = CachedAuthUser;

declare global {
  interface Window {
    __tbtSessionReady?: Promise<SessionUser | null>;
  }
}

function isProtectedPath() {
  return protectedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function setAccountUi(user: SessionUser | null) {
  const name = user ? getDisplayName(user) : "Sign in";
  const initials = user ? getInitials(name) : "?";

  document.querySelectorAll<HTMLElement>("[data-account-name]").forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll<HTMLElement>("[data-account-initials]").forEach((el) => {
    el.textContent = initials;
  });
  document.querySelectorAll<HTMLAnchorElement>("[data-account-link]").forEach((el) => {
    el.href = user ? "/auth" : `/auth?redirectTo=${encodeURIComponent(pathname)}`;
  });
}

function cacheUser(user: SessionUser | null) {
  writeCachedAuthUser(user);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function resolveSessionUser() {
  if (!hasAuthConfig()) return null;

  const auth = getAuthClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < SESSION_RETRIES; attempt++) {
    try {
      const result = await auth.getSession();
      const user = result.data?.user ?? null;
      if (user?.id) return user;
    } catch (error) {
      lastError = error;
    }

    if (attempt < SESSION_RETRIES - 1) {
      await sleep(SESSION_RETRY_MS * (attempt + 1));
    }
  }

  if (lastError) {
    console.warn("Neon Auth session check failed after retries; keeping cached account if available.", lastError);
  }

  return null;
}

async function bootSession() {
  const cached = readCachedAuthUser();

  if (!hasAuthConfig()) {
    if (cached) {
      setAccountUi(cached);
      return cached;
    }

    setAccountUi(null);
    if (isProtectedPath()) {
      console.warn("PUBLIC_NEON_AUTH_URL is not configured; auth-protected pages cannot be enforced yet.");
    }
    return null;
  }

  const verified = await resolveSessionUser();

  if (verified) {
    cacheUser(verified);
    setAccountUi(verified);
    return verified;
  }

  if (cached) {
    window.__tbtAuthUser = cached;
    setAccountUi(cached);
    return cached;
  }

  cacheUser(null);
  setAccountUi(null);

  if (isProtectedPath()) {
    window.location.href = `/auth?redirectTo=${encodeURIComponent(pathname + window.location.search)}`;
  }

  return null;
}

const cachedUser = readCachedAuthUser();
if (cachedUser) {
  window.__tbtAuthUser = cachedUser;
  setAccountUi(cachedUser);
}

window.__tbtSessionReady = bootSession();
