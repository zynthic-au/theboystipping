import { getAuthClient, getDisplayName, getInitials, getStorageKey, hasAuthConfig, removeLegacyStorageKey } from "./auth-client";

const protectedPathPrefixes = ["/tips", "/groups"];
const pathname = window.location.pathname;

type SessionUser = { id?: string; name?: string | null; email?: string | null; initials?: string | null };

declare global {
  interface Window {
    __tbtAuthUser?: SessionUser | null;
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
  if (!user) {
    localStorage.removeItem("tbt.authUser");
    localStorage.removeItem(getStorageKey("authUser"));
    window.__tbtAuthUser = null;
    return;
  }

  const cachedUser = {
    id: user.id,
    name: getDisplayName(user),
    email: user.email,
    initials: getInitials(getDisplayName(user)),
  };

  removeLegacyStorageKey("authUser");
  localStorage.setItem(getStorageKey("authUser"), JSON.stringify(cachedUser));
  window.__tbtAuthUser = cachedUser;
}

async function bootSession() {
  if (!hasAuthConfig()) {
    setAccountUi(null);
    if (isProtectedPath()) {
      console.warn("PUBLIC_NEON_AUTH_URL is not configured; auth-protected pages cannot be enforced yet.");
    }
    return null;
  }

  let user: SessionUser | null = null;

  try {
    const auth = getAuthClient();
    const result = await auth.getSession();
    user = result.data?.user ?? null;
  } catch (error) {
    console.error("Neon Auth session check failed", error);
    cacheUser(null);
    setAccountUi(null);

    if (isProtectedPath()) {
      window.location.href = `/auth?redirectTo=${encodeURIComponent(pathname + window.location.search)}&error=session`;
    }
    return null;
  }

  cacheUser(user);
  setAccountUi(user);

  if (!user && isProtectedPath()) {
    window.location.href = `/auth?redirectTo=${encodeURIComponent(pathname + window.location.search)}`;
  }

  return user;
}

window.__tbtSessionReady = bootSession();
