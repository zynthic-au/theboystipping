import { MutationObserver, QueryClient } from "@tanstack/query-core";

import { getStorageKey, readCachedAuthUser } from "./auth-client";

type Team = { code: string; name: string; city: string };
type Match = { id: string; home: string; away: string; result: string | null; time: string };
type Round = { id: string; n: number; label: string; status: string; closes: string; closesAt: string | null; matches: Match[] };
type Member = {
  id: string;
  name: string;
  fullName: string;
  team: string | null;
  joined: string;
  initials: string;
  you: boolean;
};
type Group = {
  id: string;
  name: string;
  tag: string;
  joinCode: string;
  memberIds: string[];
  description: string;
  members: number;
};
type ApiGroup = { id: string; name: string; description: string | null; joinCode: string; createdAt?: string };
type Picks = Record<number, Record<string, { picks: Record<string, string>; joker?: boolean }>>;
type AppData = {
  teams: Team[];
  rounds: Round[];
  groups: Group[];
  members: Member[];
  picks: Picks;
  jokerRounds: { roundNumber: number; isLocked: boolean }[];
  currentRound: number | null;
};
type AppView = "home" | "profile" | "groups" | "group";
type AuthUser = { id?: string; name?: string | null; email?: string | null; initials?: string | null };
type CachedAppData = { savedAt: number; data: AppData };

declare global {
  interface Window {
    __tbtAuthUser?: AuthUser | null;
    __tbtSessionReady?: Promise<AuthUser | null>;
  }
}

const APP_STATE_CACHE_TTL_MS = 30_000;
const SESSION_WAIT_MS = 2_500;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: APP_STATE_CACHE_TTL_MS,
      gcTime: 5 * 60_000,
      retry: 2,
    },
    mutations: {
      retry: 1,
    },
  },
});

let user = getCurrentAuthUser();
const initialRoute = getRouteState();

let data: AppData | null = readCachedAppState();
let errorMessage = "";
let modal: "create" | "join" | null = null;
let teamDisplay: "name" | "code" = "name";
let copiedJoinCode = "";
const pendingTipSaves = new Map<string, number>();
let state = {
  view: initialRoute.view,
  tab: initialRoute.tab,
  groupId: initialRoute.groupId,
  pickRound: 0,
  matrixRound: 0,
};

function emptyAppData(): AppData {
  return { teams: [], rounds: [], groups: [], members: [], picks: {}, jokerRounds: [], currentRound: null };
}

if (data) syncRoundState();
updateDocumentTitle();
render();
void boot();

async function boot() {
  try {
    user = await getReadyAuthUser();

    const cached = readCachedAppState();
    if (cached) {
      data = cached;
      syncRoundState();
      render();
    }

    if (shouldBootstrapUser(user)) {
      await runApiMutation(["bootstrap", user!.id], "/api/bootstrap", { user });
      markUserBootstrapped(user!);
    }

    data = await loadAppState({ forceNetwork: true });
    syncRoundState();
    errorMessage = "";
  } catch (error) {
    if (!data) errorMessage = error instanceof Error ? error.message : "Failed to load app data";
    else console.warn("Could not refresh app data", error);
  } finally {
    setupTweaks();
    render();
  }
}

async function getReadyAuthUser() {
  if (window.__tbtSessionReady) {
    await Promise.race([
      window.__tbtSessionReady.catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, SESSION_WAIT_MS)),
    ]);
  }

  return getCurrentAuthUser();
}

async function fetchAppStateFromApi() {
  const path = user?.id ? `/api/app-state?userId=${encodeURIComponent(user.id)}` : "/api/app-state";
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || response.statusText);
  return payload as AppData;
}

async function loadAppState(options: { forceNetwork?: boolean } = {}) {
  const queryKey = appStateQueryKey();

  if (!options.forceNetwork) {
    const cached = queryClient.getQueryData<AppData>(queryKey) || readCachedAppState();
    if (cached) {
      writeCachedAppState(cached);
      return cached;
    }
  } else {
    await queryClient.cancelQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey });
  }

  const nextData = await queryClient.fetchQuery({
    queryKey,
    queryFn: fetchAppStateFromApi,
    staleTime: options.forceNetwork ? 0 : APP_STATE_CACHE_TTL_MS,
  });
  writeCachedAppState(nextData);
  return nextData;
}

async function refreshAppState() {
  data = await loadAppState({ forceNetwork: true });
  syncRoundState();
  render();
}

async function refreshAppStateInBackground() {
  try {
    data = await loadAppState({ forceNetwork: true });
    syncRoundState();
    render();
  } catch (error) {
    console.warn("Could not refresh app data", error);
  }
}

function syncRoundState() {
  if (!data) return;

  if (!round(state.pickRound)) state.pickRound = data.currentRound || data.rounds[0]?.n || 0;
  if (!round(state.matrixRound)) state.matrixRound = state.pickRound;
}

function getCurrentAuthUser(): AuthUser | null {
  if (window.__tbtAuthUser !== undefined) return window.__tbtAuthUser;
  return readCachedAuthUser();
}

function appStateCacheKey() {
  return `${getStorageKey("appState")}:${user?.id || "anon"}`;
}

function appStateQueryKey() {
  return ["app-state", user?.id || "anon"] as const;
}

function bootstrapCacheKey(nextUser: AuthUser) {
  return `${getStorageKey("bootstrapped")}:${nextUser.id}`;
}

function bootstrapSignature(nextUser: AuthUser) {
  return JSON.stringify({ name: nextUser.name || null, email: nextUser.email || null });
}

function shouldBootstrapUser(nextUser: AuthUser | null) {
  if (!nextUser?.id) return false;

  try {
    return sessionStorage.getItem(bootstrapCacheKey(nextUser)) !== bootstrapSignature(nextUser);
  } catch {
    return true;
  }
}

function markUserBootstrapped(nextUser: AuthUser) {
  try {
    sessionStorage.setItem(bootstrapCacheKey(nextUser), bootstrapSignature(nextUser));
  } catch {
    // If session storage is blocked, bootstrapping is still safe to repeat.
  }
}

function readCachedAppState() {
  try {
    const queryData = queryClient.getQueryData<AppData>(appStateQueryKey());
    if (queryData) return queryData;

    const cached = JSON.parse(sessionStorage.getItem(appStateCacheKey()) || "null") as CachedAppData | null;
    if (!cached || Date.now() - cached.savedAt > APP_STATE_CACHE_TTL_MS) return null;
    queryClient.setQueryData(appStateQueryKey(), cached.data);
    return cached.data;
  } catch {
    sessionStorage.removeItem(appStateCacheKey());
    return null;
  }
}

function writeCachedAppState(nextData: AppData) {
  queryClient.setQueryData(appStateQueryKey(), nextData);

  try {
    sessionStorage.setItem(appStateCacheKey(), JSON.stringify({ savedAt: Date.now(), data: nextData } satisfies CachedAppData));
  } catch {
    // Storage can be unavailable in private contexts; the network path still works.
  }
}

async function apiPost(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || response.statusText);
  return payload;
}

async function runApiMutation<TResponse>(mutationKey: readonly unknown[], path: string, body: unknown) {
  const observer = new MutationObserver<TResponse, Error, unknown>(queryClient, {
    mutationKey,
    mutationFn: (variables) => apiPost(path, variables) as Promise<TResponse>,
  });

  return observer.mutate(body);
}

function ensureCurrentMember() {
  if (!data || !user?.id || data.members.some((item) => item.id === user!.id)) return;

  data.members.push({
    id: user.id,
    name: user.name || "You",
    fullName: user.name || "You",
    team: null,
    joined: "today",
    initials: user.initials || getInitials(user.name || "You"),
    you: true,
  });
}

function upsertLocalGroup(group: Group) {
  if (!data) return;

  ensureCurrentMember();
  const index = data.groups.findIndex((item) => item.id === group.id);
  if (index >= 0) data.groups[index] = group;
  else data.groups.unshift(group);
  writeCachedAppState(data);
}

function removeLocalGroup(groupId: string) {
  if (!data) return;

  data.groups = data.groups.filter((item) => item.id !== groupId);
  writeCachedAppState(data);
}

function groupFromApi(group: ApiGroup, fallback?: Partial<Group>): Group {
  const memberIds = fallback?.memberIds?.length ? fallback.memberIds : user?.id ? [user.id] : [];

  return {
    id: group.id,
    name: group.name,
    tag: fallback?.tag === "Joining..." || fallback?.tag === "Saving..." ? "Synced" : fallback?.tag || "Synced",
    joinCode: group.joinCode,
    memberIds,
    description: group.description || fallback?.description || "",
    members: Math.max(memberIds.length, fallback?.members || 1),
  };
}

async function saveGroupOptimistically(form: HTMLFormElement) {
  if (!user?.id || !data) return;

  const values = new FormData(form);
  const action = form.dataset.groupForm;
  const joinCode = action === "join" ? getJoinCodeFromForm(form) : "";

  if (action === "join" && joinCode.length < 6) {
    alert("Enter the 6-character group code.");
    return;
  }

  const tempId = `pending-${Date.now()}`;
  const optimisticGroup: Group = action === "create"
    ? {
        id: tempId,
        name: String(values.get("name") || "New group").trim() || "New group",
        tag: "Saving...",
        joinCode: "...",
        memberIds: [user.id],
        description: String(values.get("description") || "").trim(),
        members: 1,
      }
    : {
        id: tempId,
        name: "Joining group...",
        tag: "Joining...",
        joinCode,
        memberIds: [user.id],
        description: "Checking the join code and adding you now.",
        members: 1,
      };

  modal = null;
  upsertLocalGroup(optimisticGroup);
  if (state.view !== "groups") goto("groups");
  else render();

  try {
    const payload = await runApiMutation<{ group: ApiGroup }>(["groups", action || "save"], "/api/groups", {
      action,
      user,
      userId: user.id,
      name: values.get("name"),
      description: values.get("description"),
      joinCode,
    });

    removeLocalGroup(tempId);
    upsertLocalGroup(groupFromApi(payload.group, optimisticGroup));
    render();
    void refreshAppStateInBackground();
  } catch (error) {
    removeLocalGroup(tempId);
    render();
    alert(error instanceof Error ? error.message : "Failed to save group");
  }
}

function render() {
  document.documentElement.dataset.teamDisplay = teamDisplay;
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("active", isActive((btn as HTMLElement).dataset.view));
  });

  const app = document.getElementById("app");
  if (!app) return;

  if (errorMessage && !data) {
    app.innerHTML = `<section class="card card-pad"><span class="eyebrow accent">Database</span><h1>Could not load app data.</h1><p class="muted">${esc(errorMessage)}</p></section>`;
    return;
  }

  const savedData = data;
  if (!data) data = emptyAppData();
  try {
    if (state.view === "profile") app.innerHTML = profileView();
    else if (state.view === "groups") app.innerHTML = groupsView();
    else if (state.view === "group") app.innerHTML = groupView();
    else app.innerHTML = homeView();
  } finally {
    data = savedData;
  }

  if (modal) {
    app.insertAdjacentHTML("beforeend", modalView());
    focusModalInput();
  }
}

function focusModalInput() {
  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(modal === "join" ? "[data-join-code-box]" : ".modal input[autofocus]");
    input?.focus();
    input?.select();
  });
}

function isActive(view?: string) {
  return state.view === view || (view === "groups" && state.view === "group");
}

function goto(view: string, params: Record<string, string | number> = {}) {
  const nextPath = getPathForView(view, params);
  applyRoute(getRouteState(nextPath), nextPath);
}

function getRouteState(path = window.location.pathname + window.location.search) {
  const url = new URL(path, window.location.origin);
  const routePath = url.pathname.replace(/\/$/, "") || "/";

  if (routePath === "/tips") {
    return { view: "profile" as AppView, tab: url.searchParams.get("tab") || "picks", groupId: "" };
  }

  if (routePath === "/groups") {
    return { view: "groups" as AppView, tab: "picks", groupId: "" };
  }

  if (routePath.startsWith("/groups/")) {
    return {
      view: "group" as AppView,
      tab: url.searchParams.get("tab") || "leaderboard",
      groupId: decodeURIComponent(routePath.split("/")[2] || ""),
    };
  }

  return { view: "home" as AppView, tab: "picks", groupId: "" };
}

function getPathForView(view: string, params: Record<string, string | number> = {}) {
  if (view === "profile") return "/tips" + (params.tab ? `?tab=${encodeURIComponent(String(params.tab))}` : "");
  if (view === "groups") return "/groups";
  if (view === "group") return `/groups/${encodeURIComponent(String(params.groupId || state.groupId))}`;
  return "/";
}

function applyRoute(route: ReturnType<typeof getRouteState>, path: string, replace = false) {
  state.view = route.view;
  state.tab = route.tab;
  state.groupId = route.groupId;
  modal = null;

  const nextUrl = new URL(path, window.location.origin);
  if (window.location.pathname + window.location.search !== nextUrl.pathname + nextUrl.search) {
    if (replace) window.history.replaceState(null, "", nextUrl.pathname + nextUrl.search);
    else window.history.pushState(null, "", nextUrl.pathname + nextUrl.search);
  }

  updateDocumentTitle();
  window.scrollTo({ top: 0, behavior: "auto" });
  render();
}

function replaceUrl(path: string) {
  const nextUrl = new URL(path, window.location.origin);
  if (window.location.pathname + window.location.search !== nextUrl.pathname + nextUrl.search) {
    window.history.replaceState(null, "", nextUrl.pathname + nextUrl.search);
  }
}

function updateDocumentTitle() {
  const suffix = "The Boys Tipping";
  if (state.view === "profile") document.title = `${suffix} · Tips`;
  else if (state.view === "groups") document.title = `${suffix} · Groups`;
  else if (state.view === "group") document.title = `${suffix} · Group`;
  else document.title = `${suffix} · Home`;
}

function homeView() {
  const current = currentRound();
  if (!current) return emptyState("No rounds yet", "Rounds and matches will appear here once they exist in the database.");

  const picks = currentUserPicks(current.n);
  const tipped = Object.keys(picks).length;
  const remaining = current.matches.length - tipped;
  const greeting = user?.name ? `G'day ${esc(user.name)}` : "The Boys Tipping";
  const points = user?.id ? seasonTotal(user.id) : 0;
  const lastDoneRound = [...data!.rounds].reverse().find((item) => item.status === "done");
  const countdown = getCountdownParts(current.closesAt);
  const jokerBanner = user?.id && !currentJokerRound() && jokersLeft() > 0
    ? `<section class="joker-banner" style="margin-bottom:28px"><div class="row" style="gap:14px"><span class="icon">${icon(18)}</span><div><div style="font-weight:600">You've got ${jokersLeft()} joker round${jokersLeft() === 1 ? "" : "s"} banked.</div><div style="font-size:13px;opacity:.85;margin-top:2px">Arm a round to make every correct pick worth double.</div></div></div><button class="btn btn-sm" data-action="profile-joker">Use joker</button></section>`
    : "";

  return `<section class="hero"><div class="hero-title"><span class="eyebrow accent">${greeting}</span><h1>${user?.id ? remaining ? `You've got <span style="color:var(--accent)">${remaining} tips</span> left for ${esc(current.label)}.` : `You're locked in for ${esc(current.label)}.` : "Sign in to save tips and join groups."}</h1><p class="muted" style="font-size:17px;max-width:460px">Round closes ${esc(current.closes)}. Pick your winners and arm your joker if you're feeling brave.</p><div class="row" style="margin-top:14px;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" data-action="profile-picks">${user?.id ? remaining ? "Finish your tips" : "Review picks" : "Sign in"} -&gt;</button><button class="btn" data-view="groups">See groups</button></div></div><div class="hero-stats"><div class="stat"><span class="stat-lbl">Round closes in</span><div class="row" style="align-items:baseline">${countdown ? `<span class="countdown"><span class="num">${countdown.days}</span><span class="lbl">d</span></span><span class="countdown"><span class="num">${countdown.hours}</span><span class="lbl">h</span></span><span class="countdown"><span class="num">${countdown.minutes}</span><span class="lbl">m</span></span>` : `<span class="stat-val mono">TBC</span>`}</div></div><div class="stat"><span class="stat-lbl">Tips placed</span><span class="stat-val mono">${tipped}<span class="faint">/${current.matches.length}</span></span></div><div class="stat"><span class="stat-lbl">Season points</span><span class="stat-val mono">${points}</span></div><div class="stat"><span class="stat-lbl">Last complete</span><span class="stat-val mono" style="color:var(--good)">${lastDoneRound ? `+${user?.id ? scoreRound(user.id, lastDoneRound.n) : 0}` : "-"}</span></div></div></section>${jokerBanner}<section class="grid grid-2"><div class="card card-pad"><div class="card-head"><h3>${esc(current.label)} fixtures</h3><span class="meta">${esc(current.status)}</span></div><div class="col" style="gap:10px">${current.matches.map((match) => fixtureRow(match, picks[match.id])).join("")}</div></div><div class="card card-pad"><div class="card-head"><h3>Your groups</h3><span class="meta">${data!.groups.length}</span></div>${user?.id ? data!.groups.length ? `<div class="col" style="gap:10px">${data!.groups.slice(0, 4).map(groupMiniCard).join("")}</div>` : `<p class="muted">You have not joined any groups yet.</p><button class="btn btn-primary" data-view="groups" style="margin-top:14px">Create or join a group</button>` : `<p class="muted">Sign in to load your database-backed groups.</p><a class="btn btn-primary" href="/auth" style="text-decoration:none;margin-top:14px">Sign in</a>`}</div></section>`;
}

function fixtureRow(match: Match, pickCode?: string) {
  const home = team(match.home);
  const away = team(match.away);
  const pickTeam = pickCode ? team(pickCode) : null;

  return `<div class="fix"><span class="fix-time">${esc(match.time)}</span><span class="fix-team">${esc(home?.name || match.home)}</span><span class="fix-vs">vs</span><span class="fix-team away">${esc(away?.name || match.away)}</span><span class="fix-pick ${pickCode ? "" : "empty"}">${pickTeam ? `Pick: ${esc(pickTeam.code)}` : "No pick"}</span></div>`;
}

function profileView() {
  if (!user?.id) return authRequired();

  const me = currentMember();
  const current = round(state.pickRound) || currentRound();
  if (!current) return emptyState("No rounds yet", "Add rounds and matches to the database before tipping.");

  const body = state.tab === "overview" ? overviewPanel() : state.tab === "joker" ? jokerPanel() : picksPanel(current);
  const avg = averageScore(user.id);

  return `<section><div class="row" style="gap:24px;align-items:center;margin-bottom:28px;flex-wrap:wrap">${avatar(me, "xl")}<div style="flex:1;min-width:220px"><span class="eyebrow accent">Profile</span><h1 style="font-size:44px;margin-top:6px">${esc(me.fullName)}</h1><div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${pill(me.team ? `Backing ${team(me.team)?.name || me.team}` : "No favourite team set")}${pill(`Joined ${me.joined}`)}</div></div><div class="row" style="gap:28px;flex-wrap:wrap"><div class="stat"><span class="stat-lbl">Season pts</span><span class="stat-val mono">${seasonTotal(user.id)}</span></div><div class="stat"><span class="stat-lbl">Avg / round</span><span class="stat-val mono">${avg.toFixed(1)}</span></div><div class="stat"><span class="stat-lbl">Streak</span><span class="stat-val mono">${currentStreak(user.id)}</span></div></div></div><div class="row" style="margin-bottom:24px;justify-content:space-between;flex-wrap:wrap;gap:16px"><div class="tabs"><button class="tab ${state.tab === "overview" ? "active" : ""}" data-tab="overview">Overview</button><button class="tab ${state.tab === "picks" ? "active" : ""}" data-tab="picks">This week's tips</button><button class="tab ${state.tab === "joker" ? "active" : ""}" data-tab="joker">Joker rounds</button></div></div>${body}</section>`;
}

function overviewPanel() {
  const scores = data!.rounds.filter((item) => item.status === "done").map((item) => ({ round: item, score: scoreRound(user!.id!, item.n) }));
  const max = Math.max(1, ...scores.map((item) => item.score));

  return `<div class="grid grid-2"><div class="card card-pad"><div class="card-head"><h3>Weekly form</h3><span class="meta">Database results</span></div>${scores.length ? `<div style="display:flex;align-items:flex-end;gap:6px;height:140px;padding:10px 0">${scores.map((item, index) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"><span class="mono faint" style="font-size:11px">${item.score}</span><div style="width:100%;height:${(item.score / max) * 100}%;background:${index === scores.length - 1 ? "var(--accent)" : "var(--accent-soft)"};border-radius:6px 6px 2px 2px;min-height:6px"></div><span class="mono faint" style="font-size:10px">R${item.round.n}</span></div>`).join("")}</div>` : `<p class="muted">Completed rounds with winners will appear here.</p>`}</div><div class="card card-pad"><div class="card-head"><h3>Season summary</h3></div><div class="col" style="gap:12px"><div class="callout good"><span class="mono" style="font-size:22px;font-weight:600">${seasonTotal(user!.id!)}</span><div><span class="label">Points</span><div class="who">Calculated from stored tips and match winners.</div></div></div><div class="callout"><span class="mono" style="font-size:22px;font-weight:600">${scores.length}</span><div><span class="label">Scored rounds</span><div class="who">No historical placeholder form is used.</div></div></div></div></div></div>`;
}

function picksPanel(current: Round) {
  const myPicks = currentUserPicks(current.n);
  const tipped = Object.keys(myPicks).length;
  const remaining = current.matches.length - tipped;
  const isLocked = current.status === "done";
  const armed = currentJokerRound() === current.n;

  return `<div><div style="margin-bottom:18px"><div class="round-scroll">${data!.rounds.map((item) => `<button class="round-chip ${item.n === state.pickRound ? "active" : ""} ${item.n === currentJokerRound() ? "joker" : ""}" data-round="${item.n}">R${item.n}</button>`).join("")}</div></div><div class="row" style="margin-bottom:18px;justify-content:space-between;flex-wrap:wrap;gap:14px"><div><h2 style="margin-bottom:4px">${esc(current.label)}</h2><div class="muted" style="font-size:14px">${isLocked ? "Round closed." : `Closes ${esc(current.closes)} · ${remaining ? `${remaining} tips to go` : "All tips in"}`}</div></div>${!isLocked ? `<div class="joker-card ${armed ? "armed" : ""}" style="min-width:260px"><div class="joker-left"><span class="icon">${icon(20)}</span><div><div class="joker-title">${armed ? "Joker armed for this round" : "Use joker on this round"}</div><div class="joker-sub">${armed ? "Correct picks worth 2x points." : `${jokersLeft()} joker${jokersLeft() === 1 ? "" : "s"} left this season.`}</div></div></div><button class="swt" data-action="toggle-joker" data-on="${armed ? 1 : 0}" ${!armed && jokersLeft() <= 0 ? "disabled" : ""} aria-label="Toggle joker"></button></div>` : ""}</div><div class="col" style="gap:10px">${current.matches.map((match) => matchCard(match, myPicks[match.id], isLocked, armed)).join("")}</div></div>`;
}

function matchCard(match: Match, picked: string | undefined, locked: boolean, jokerRound: boolean) {
  const home = team(match.home);
  const away = team(match.away);

  return `<div class="match ${jokerRound ? "joker" : ""}"><div class="match-meta"><div class="match-meta-left"><span>${esc(match.time)}</span>${jokerRound ? pill(`${icon(11)} Joker · 2x pts`, "joker") : ""}</div>${match.result ? `<span>FT · ${esc(match.result)}</span>` : locked ? `<span>Locked</span>` : ""}</div>${teamButton(match.id, home, match.home, "Home", picked, locked)}<div class="match-divider">vs</div>${teamButton(match.id, away, match.away, "Away", picked, locked)}</div>`;
}

function teamButton(matchId: string, item: Team | undefined, code: string, side: string, picked?: string, locked = false) {
  return `<button class="team-btn ${picked === code ? "picked" : ""}" data-pick-match="${esc(matchId)}" data-pick-team="${esc(code)}" ${locked ? "disabled" : ""}>${picked === code ? `<span class="check">✓</span>` : ""}<span class="team-code">${esc(code)} · ${side}</span><span class="team-name">${teamDisplay === "code" ? esc(code) : esc(item?.name || code)}</span><span class="team-full">${esc(item?.city || "")}</span></button>`;
}

function jokerPanel() {
  const armed = currentJokerRound();
  const locked = data!.jokerRounds.filter((item) => item.isLocked).map((item) => item.roundNumber);
  const candidates = data!.rounds.filter((item) => item.status !== "done");

  return `<div class="grid grid-2"><div class="card card-pad"><div class="card-head"><h3>Joker rounds</h3><span class="meta">${jokersLeft()} left</span></div><p class="muted">You get <b style="color:var(--fg)">two joker rounds</b> per season. Arm one and every correct tip that round counts double.</p><div class="col" style="gap:10px;margin-top:18px">${[0, 1].map((_, index) => { const usedRound = locked[index]; const isArmed = !usedRound && armed && index === locked.length; return `<div class="joker-card ${isArmed ? "armed" : ""}"><div class="joker-left"><span class="icon">${isArmed ? icon(18) : index + 1}</span><div><div class="joker-title">${usedRound ? `Used on Round ${usedRound}` : isArmed ? `Armed for Round ${armed}` : "Available"}</div><div class="joker-sub">${usedRound ? "Banked. Can't change now." : isArmed ? "Tap Disarm to free this back up." : "Choose a round to double up on."}</div></div></div>${isArmed ? `<button class="btn btn-sm" data-action="disarm-joker">Disarm</button>` : ""}</div>`; }).join("")}</div></div><div class="card card-pad"><div class="card-head"><h3>Pick a round to arm</h3></div><p class="muted" style="font-size:14px">Tap a round to set it as your joker. You can swap until kick-off.</p><div class="col" style="gap:8px;margin-top:14px">${candidates.map((item) => { const isThis = armed === item.n; return `<button class="fix clickable" data-arm-round="${item.n}" style="grid-template-columns:auto 1fr auto;padding:14px 16px;${isThis ? "border-color:var(--joker);background:var(--joker-soft)" : ""}"><span class="mono" style="font-size:13px;font-weight:600;color:${isThis ? "var(--joker)" : "var(--fg)"}">R${item.n}</span><div style="text-align:left"><div style="font-weight:500;font-size:14px">${esc(item.label)}</div><div class="group-card-meta">Closes ${esc(item.closes)}</div></div>${isThis ? pill(`${icon(11)} Armed`, "joker") : `<span class="mono faint" style="font-size:12px">Select</span>`}</button>`; }).join("")}</div></div></div>`;
}

function groupsView() {
  if (!user?.id) return authRequired();

  return `<section><div class="row" style="justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:14px"><div><span class="eyebrow accent">Groups</span><h1 style="font-size:44px;margin-top:6px">Your tipping comps</h1><p class="muted" style="max-width:520px;margin-top:6px">You're in ${data!.groups.length} groups. Tip once a round and your picks count in every comp you've joined.</p></div><div class="row" style="gap:10px"><button class="btn" data-modal="join">Join with code</button><button class="btn btn-primary" data-modal="create">+ Create group</button></div></div>${data!.groups.length ? `<div class="grid grid-2">${data!.groups.map(groupCard).join("")}<button class="group-card" data-modal="create" style="border-style:dashed;justify-content:center;align-items:center;min-height:220px;gap:10px"><div style="width:44px;height:44px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;font-size:24px;font-weight:500">+</div><div style="font-size:16px;font-weight:500">Start a new group</div><div class="muted" style="font-size:13px;text-align:center">Creates a real database group and membership.</div></button></div>` : emptyState("No groups yet", "Create a group or join one with a code. Groups are stored in the database.")}</section>`;
}

function groupCard(group: Group) {
  const rows = leaderboardRows(group.memberIds.map(member).filter(Boolean) as Member[]);
  const myRank = rows.findIndex((row) => row.id === user?.id) + 1;
  const leader = rows[0];
  const variant = myRank > 0 && myRank <= 2 ? "good" : myRank === group.members ? "bad" : "";
  const current = currentRound();
  const tipped = current && user?.id ? Object.keys(currentUserPicks(current.n)).length : 0;

  return `<button class="group-card" data-group="${esc(group.id)}"><div class="group-card-head"><div><h3 class="group-card-name">${esc(group.name)}</h3><div class="group-card-meta" style="margin-top:4px">${esc(group.tag)} · ${group.members} members</div></div>${myRank ? pill(`#${myRank} of ${group.members}`, variant) : ""}</div><div class="muted" style="font-size:14px;line-height:1.5">${esc(group.description || "No description yet.")}</div><div class="row" style="gap:8px">${group.memberIds.slice(0, 5).map((id) => avatar(member(id), "sm")).join("")}${group.members > 5 ? `<span class="mono faint" style="font-size:11px;margin-left:4px">+${group.members - 5} more</span>` : ""}</div><div class="group-card-stats"><div class="stat"><span class="stat-lbl">Your pts</span><span class="stat-val mono">${user?.id ? seasonTotal(user.id) : 0}</span></div><div class="stat"><span class="stat-lbl">R${current?.n || "-"} picks</span><span class="stat-val mono">${tipped}<span class="faint">/${current?.matches.length || 0}</span></span></div><div class="stat"><span class="stat-lbl">Leader</span><span class="stat-val mono" style="font-size:18px">${leader ? esc(leader.name) : "-"}</span></div></div></button>`;
}

function groupMiniCard(group: Group) {
  return `<button class="fix clickable" data-group="${esc(group.id)}" style="grid-template-columns:1fr auto;padding:14px 16px"><span><b>${esc(group.name)}</b><small class="group-card-meta" style="display:block;margin-top:4px">${group.members} members · code ${esc(group.joinCode)}</small></span><span class="mono faint">Open</span></button>`;
}

function copyJoinCodeButton(code: string) {
  return `<button class="copy-code mono" type="button" data-copy-code="${esc(code)}" aria-label="Copy join code ${esc(code)}"><span>${esc(code)}</span>${copiedJoinCode === code ? `<small>Copied</small>` : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/></svg>`}</button>`;
}

function groupView() {
  if (!user?.id) return authRequired();

  const group = data!.groups.find((item) => item.id === state.groupId) || data!.groups[0];
  if (!group) return emptyState("Group not found", "Create or join a group to see standings.");

  const members = group.memberIds.map(member).filter(Boolean) as Member[];
  const rows = leaderboardRows(members);
  const leader = rows[0];

  return `<section><button class="btn btn-ghost btn-sm" data-view="groups" style="margin-bottom:14px">&lt;- All groups</button><div class="group-detail-head"><div><span class="eyebrow accent">${esc(group.tag)}</span><h1 style="font-size:48px;margin-top:6px">${esc(group.name)}</h1><p class="muted" style="margin-top:8px;font-size:15px;max-width:540px">${esc(group.description || "No description yet.")}</p><div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">${pill(`${members.length} members`)}<span class="pill copy-code-pill">Code ${copyJoinCodeButton(group.joinCode)}</span>${currentRound() ? pill(`Round ${currentRound()!.n} ${currentRound()!.status}`) : ""}</div></div><div class="group-detail-stats"><div class="stat"><span class="stat-lbl">Rank</span><span class="stat-val mono">#${rows.findIndex((row) => row.id === user.id) + 1 || "-"}</span></div><div class="stat"><span class="stat-lbl">Points</span><span class="stat-val mono">${seasonTotal(user.id)}</span></div><div class="stat"><span class="stat-lbl">Leader</span><span class="stat-val mono" style="font-size:22px">${leader ? esc(leader.name) : "-"}</span></div></div></div><div class="row" style="margin-bottom:18px;justify-content:space-between;flex-wrap:wrap;gap:14px"><div class="tabs"><button class="tab ${state.tab !== "picks" ? "active" : ""}" data-group-tab="leaderboard">Leaderboard</button><button class="tab ${state.tab === "picks" ? "active" : ""}" data-group-tab="picks">Picks matrix</button></div></div>${state.tab === "picks" ? matrix(members) : leaderboard(rows)}</section>`;
}

function leaderboardRows(members: Member[]) {
  return members
    .map((item) => ({
      ...item,
      pts: seasonTotal(item.id),
      lastWeek: lastRoundScore(item.id),
      streak: currentStreak(item.id),
    }))
    .sort((a, b) => b.pts - a.pts);
}

function leaderboard(rows: ReturnType<typeof leaderboardRows>) {
  return `<div class="card card-pad"><div class="card-head"><h3>Season standings</h3><span class="meta">Database totals</span></div><div class="lb">${rows.map((row, index) => `<div class="lb-row ${row.you ? "you" : ""}"><span class="lb-rank ${index < 3 ? "top" : ""}">${index + 1}</span>${avatar(row)}<div><div class="lb-name">${esc(row.name)}${row.you ? `<span style="color:var(--accent);font-weight:500"> · you</span>` : ""}<small>${row.streak > 0 ? `Fire ${row.streak} streak · ` : ""}Last round: ${row.lastWeek}</small></div></div><div></div><div class="row" style="gap:12px;justify-content:flex-end"><span class="lb-pts">${row.pts}</span></div></div>`).join("")}</div></div>`;
}

function matrix(members: Member[]) {
  const selected = round(state.matrixRound) || currentRound();
  if (!selected) return emptyState("No rounds yet", "Picks matrix needs database rounds.");

  const available = data!.rounds.filter((item) => item.status === "done" || item.n === data!.currentRound);
  const isComplete = selected.status === "done";
  const allPicks = data!.picks[selected.n] || {};

  return `<div><div class="row" style="gap:8px;margin-bottom:16px;flex-wrap:wrap">${available.map((item) => `<button class="round-chip ${state.matrixRound === item.n ? "active" : ""}" data-matrix-round="${item.n}">${esc(item.label)}${item.status === "open" ? " · live" : ""}</button>`).join("")}</div><div class="card card-pad-sm"><div class="card-head" style="padding:12px 8px 8px;margin-bottom:8px"><h3>${esc(selected.label)} · members' picks</h3><span class="meta">${isComplete ? "Final" : "Picks revealed at kick-off"}</span></div><div class="matrix-wrap"><table class="matrix"><thead><tr><th class="name-col">Member</th>${selected.matches.map((match) => `<th><div class="match-col"><b>${esc(match.home)} <span class="faint">v</span> ${esc(match.away)}</b>${match.result ? `<span style="color:var(--good)">FT · ${esc(match.result)}</span>` : `<span>${esc(match.time)}</span>`}</div></th>`).join("")}<th><div class="match-col"><b>TOTAL</b><span>${isComplete ? "Pts" : "So far"}</span></div></th></tr></thead><tbody>${members.map((item) => matrixRow(item, selected, allPicks, isComplete)).join("")}</tbody></table></div></div></div>`;
}

function matrixRow(member: Member, selected: Round, allPicks: Record<string, { picks: Record<string, string>; joker?: boolean }>, isComplete: boolean) {
  const picks = allPicks[member.id]?.picks || {};
  const usesJoker = !!allPicks[member.id]?.joker;
  let total = 0;
  const cells = selected.matches.map((match) => {
    const pick = picks[match.id];
    const hidden = !isComplete && !member.you && selected.status === "open";
    let cls = "pick-cell";
    let text = "-";
    if (!pick) cls += " empty";
    else if (hidden) {
      cls += " pending";
      text = "•";
    } else if (match.result) {
      if (pick === match.result) {
        cls += " win";
        total += usesJoker ? 2 : 1;
      } else cls += " loss";
      text = pick;
    } else {
      cls += " locked";
      text = pick;
    }
    if (usesJoker && pick && !hidden) cls += " joker";
    return `<td><div class="${cls}">${esc(text)}</div></td>`;
  }).join("");

  return `<tr><td class="name-cell"><span class="row" style="gap:8px">${avatar(member, "sm")}${esc(member.name)}${member.you ? `<span style="color:var(--accent);font-weight:500"> · you</span>` : ""}</span></td>${cells}<td><div class="total-cell">${total > 0 ? total : isComplete ? "0" : "-"}</div></td></tr>`;
}

function modalView() {
  const create = modal === "create";
  return `<div class="modal-veil" data-action="close-modal"><form class="modal" data-group-form="${create ? "create" : "join"}"><span class="eyebrow accent">${create ? "New group" : "Join a group"}</span><h3>${create ? "Start a tipping comp" : "Got a code?"}</h3><div class="modal-sub">${create ? "This creates a database group and adds you as the first member." : "Enter the join code for an existing database group."}</div>${create ? `<label class="field-label">Group name</label><input class="input" name="name" required placeholder="e.g. The Pub Tipping Crew" autofocus><label class="field-label" style="margin-top:14px">Description</label><input class="input" name="description" placeholder="Optional description">` : `<label class="field-label">Group code</label><input type="hidden" name="joinCode" data-join-code-value><div class="join-code-grid" data-join-code-grid>${Array.from({ length: 6 }, (_, index) => `<input class="join-code-box mono" data-join-code-box data-code-index="${index}" inputmode="text" autocomplete="${index === 0 ? "one-time-code" : "off"}" maxlength="1" aria-label="Code character ${index + 1}" ${index === 0 ? "autofocus" : ""}>`).join("")}</div><div class="group-card-meta" style="margin-top:10px;text-align:center">Paste or type the 6-character code</div>`}<div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${create ? "Create group" : "Join group"}</button></div></form></div>`;
}

function getJoinCodeFromForm(form: HTMLFormElement) {
  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>("[data-join-code-box]"));
  const code = boxes.map((box) => box.value).join("").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
  const hidden = form.querySelector<HTMLInputElement>("[data-join-code-value]");
  if (hidden) hidden.value = code;
  return code;
}

function fillJoinCodeBoxes(startBox: HTMLInputElement, rawValue: string) {
  const form = startBox.closest<HTMLFormElement>("[data-group-form]");
  if (!form) return;

  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>("[data-join-code-box]"));
  const startIndex = Number(startBox.dataset.codeIndex || 0);
  const chars = rawValue.replace(/[^a-z0-9]/gi, "").slice(0, boxes.length - startIndex).toUpperCase().split("");

  chars.forEach((char, offset) => {
    const box = boxes[startIndex + offset];
    if (box) box.value = char;
  });

  const next = boxes[Math.min(startIndex + chars.length, boxes.length - 1)];
  next?.focus();
  getJoinCodeFromForm(form);
}

function emptyState(title: string, copy: string) {
  return `<section class="card card-pad"><span class="eyebrow accent">Database</span><h1>${esc(title)}</h1><p class="muted">${esc(copy)}</p></section>`;
}

function authRequired() {
  return `<section class="card card-pad"><span class="eyebrow accent">Sign in required</span><h1>Connect an account to use this page.</h1><p class="muted">Tips, groups, joker rounds, and profile data are loaded from the database after authentication.</p><a class="btn btn-primary" href="/auth?redirectTo=${encodeURIComponent(window.location.pathname + window.location.search)}" style="text-decoration:none;margin-top:14px">Sign in</a></section>`;
}

function currentRound() {
  return data?.rounds.find((item) => item.n === data?.currentRound) || data?.rounds[0] || null;
}

function round(roundNumber: number) {
  return data?.rounds.find((item) => item.n === roundNumber) || null;
}

function team(code: string | null) {
  return data?.teams.find((item) => item.code === code);
}

function member(id: string | undefined) {
  return data?.members.find((item) => item.id === id);
}

function currentMember(): Member {
  return member(user?.id) || {
    id: user?.id || "",
    name: user?.name || "Account",
    fullName: user?.name || "Account",
    team: null,
    joined: "today",
    initials: user?.initials || getInitials(user?.name || "Account"),
    you: true,
  };
}

function currentUserPicks(roundNumber: number) {
  return user?.id ? data?.picks[roundNumber]?.[user.id]?.picks || {} : {};
}

function roundNumberForMatch(matchId: string) {
  return data?.rounds.find((item) => item.matches.some((match) => match.id === matchId))?.n || state.pickRound;
}

function setCurrentUserPick(roundNumber: number, matchId: string, pickedTeamCode: string | undefined) {
  if (!data || !user?.id) return;

  const roundPicks = data.picks[roundNumber] ??= {};
  const userPicks = roundPicks[user.id] ??= { picks: {} };

  if (pickedTeamCode) userPicks.picks[matchId] = pickedTeamCode;
  else delete userPicks.picks[matchId];

  writeCachedAppState(data);
}

async function saveTipOptimistically(matchId: string, pickedTeamCode: string) {
  if (!user?.id || !data) return;

  const roundNumber = roundNumberForMatch(matchId);
  const previousPick = data.picks[roundNumber]?.[user.id]?.picks[matchId];
  if (previousPick === pickedTeamCode) return;

  const version = (pendingTipSaves.get(matchId) || 0) + 1;
  pendingTipSaves.set(matchId, version);
  setCurrentUserPick(roundNumber, matchId, pickedTeamCode);
  render();

  try {
    await runApiMutation(["tips", "save", matchId], "/api/tips", { userId: user.id, matchExternalId: matchId, pickedTeamCode });
  } catch (error) {
    if (pendingTipSaves.get(matchId) === version) {
      setCurrentUserPick(roundNumber, matchId, previousPick);
      pendingTipSaves.delete(matchId);
      render();
    }
    alert(error instanceof Error ? error.message : "Failed to save tip");
    return;
  }

  if (pendingTipSaves.get(matchId) === version) pendingTipSaves.delete(matchId);
}

function currentJokerRound() {
  return data?.jokerRounds.find((item) => !item.isLocked)?.roundNumber || null;
}

function jokersLeft() {
  const used = data?.jokerRounds.filter((item) => item.isLocked).length || 0;
  const armed = currentJokerRound() ? 1 : 0;
  return Math.max(0, 2 - used - armed);
}

function scoreRound(memberId: string, roundNumber: number) {
  const item = round(roundNumber);
  const entry = data?.picks[roundNumber]?.[memberId];
  if (!item || !entry) return 0;

  const score = item.matches.reduce((total, match) => {
    if (!match.result) return total;
    return total + (entry.picks[match.id] === match.result ? 1 : 0);
  }, 0);

  return entry.joker ? score * 2 : score;
}

function seasonTotal(memberId: string) {
  return data!.rounds.reduce((total, item) => total + scoreRound(memberId, item.n), 0);
}

function averageScore(memberId: string) {
  const scored = data!.rounds.filter((item) => item.status === "done");
  if (!scored.length) return 0;
  return seasonTotal(memberId) / scored.length;
}

function currentStreak(memberId: string) {
  let streak = 0;
  for (const item of data!.rounds.filter((round) => round.status === "done")) {
    for (const match of item.matches) {
      if (!match.result) continue;
      if (data!.picks[item.n]?.[memberId]?.picks[match.id] === match.result) streak++;
      else streak = 0;
    }
  }
  return streak;
}

function lastRoundScore(memberId: string) {
  const item = [...data!.rounds].reverse().find((round) => round.status === "done");
  return item ? scoreRound(memberId, item.n) : 0;
}

function getCountdownParts(value: string | null) {
  if (!value) return null;

  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return null;

  const remaining = Math.max(0, target - Date.now());
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return { days, hours, minutes };
}

function avatar(item?: Member, size = "") {
  const safe = item || { fullName: "Member", name: "Member", initials: "?" };
  return `<span class="avatar ${size}" title="${esc(safe.fullName || safe.name)}">${esc(safe.initials)}</span>`;
}

function pill(text: string, variant = "") {
  return `<span class="pill ${variant}">${text}</span>`;
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] || char);
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function icon(size = 14) {
  return `<svg class="jester" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16c1-5 3-9 7-13 4 4 6 8 7 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 16h10l-1 5H8l-1-5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="4" r="1.5" fill="currentColor"/><circle cx="17" cy="16" r="1.5" fill="currentColor"/></svg>`;
}

function setupTweaks() {
  const accents: Record<string, [string, string]> = {
    "#c2632a": ["#f0d3b4", "#6b3210"],
    "#1f7a6b": ["#cce6df", "#0e3b32"],
    "#8b3f56": ["#efd0d8", "#4d1c2a"],
    "#3a5a8a": ["#c9d6ec", "#1a2c4a"],
    "#a89030": ["#ece1a8", "#4d3f0a"],
  };
  const swatches = document.getElementById("swatches");
  if (!swatches || swatches.dataset.ready) return;

  swatches.dataset.ready = "true";
  Object.keys(accents).forEach((hex, index) => {
    swatches.insertAdjacentHTML("beforeend", `<button class="swatch ${index === 0 ? "active" : ""}" data-accent="${hex}" style="background:${hex}" aria-label="Accent ${hex}"></button>`);
  });
  swatches.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-accent]");
    if (!btn?.dataset.accent) return;
    document.querySelectorAll(".swatch").forEach((item) => item.classList.remove("active"));
    btn.classList.add("active");
    const [soft, ink] = accents[btn.dataset.accent];
    document.documentElement.style.setProperty("--accent", btn.dataset.accent);
    document.documentElement.style.setProperty("--accent-soft", soft);
    document.documentElement.style.setProperty("--accent-ink", ink);
  });

  document.getElementById("themeToggle")?.addEventListener("click", (event) => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    (event.currentTarget as HTMLElement).classList.toggle("active", dark);
  });
  document.getElementById("densityToggle")?.addEventListener("click", (event) => {
    const compact = document.documentElement.dataset.density !== "compact";
    document.documentElement.dataset.density = compact ? "compact" : "regular";
    (event.currentTarget as HTMLElement).classList.toggle("active", compact);
  });
  document.getElementById("nameDisplay")?.addEventListener("click", () => {
    teamDisplay = "name";
    document.getElementById("nameDisplay")?.classList.add("active");
    document.getElementById("codeDisplay")?.classList.remove("active");
    render();
  });
  document.getElementById("codeDisplay")?.addEventListener("click", () => {
    teamDisplay = "code";
    document.getElementById("codeDisplay")?.classList.add("active");
    document.getElementById("nameDisplay")?.classList.remove("active");
    render();
  });
}

document.addEventListener("click", async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("button, a");
  if (!target) return;

  if (target.dataset.view) {
    event.preventDefault();
    return goto(target.dataset.view);
  }
  if (target.dataset.action === "profile-picks") {
    event.preventDefault();
    return user?.id ? goto("profile", { tab: "picks" }) : window.location.assign("/auth");
  }
  if (target.dataset.action === "profile-joker") {
    event.preventDefault();
    return user?.id ? goto("profile", { tab: "joker" }) : window.location.assign("/auth");
  }
  if (target.dataset.tab) {
    state.tab = target.dataset.tab;
    if (state.view === "profile") replaceUrl(`/tips?tab=${encodeURIComponent(state.tab)}`);
    return render();
  }
  if (target.dataset.round) {
    state.pickRound = Number(target.dataset.round);
    return render();
  }
  if (target.dataset.pickMatch && target.dataset.pickTeam && user?.id) {
    void saveTipOptimistically(target.dataset.pickMatch, target.dataset.pickTeam);
    return;
  }
  if (target.dataset.action === "toggle-joker" && user?.id) {
    const nextRound = currentJokerRound() === state.pickRound ? null : state.pickRound;
    await saveJoker(nextRound);
    return;
  }
  if (target.dataset.action === "disarm-joker" && user?.id) {
    await saveJoker(null);
    return;
  }
  if (target.dataset.armRound && user?.id) {
    const selected = Number(target.dataset.armRound);
    await saveJoker(currentJokerRound() === selected ? null : selected);
    return;
  }
  if (target.dataset.group) {
    event.preventDefault();
    return goto("group", { groupId: target.dataset.group });
  }
  if (target.dataset.groupTab) {
    state.tab = target.dataset.groupTab === "picks" ? "picks" : "leaderboard";
    replaceUrl(`/groups/${encodeURIComponent(state.groupId)}?tab=${encodeURIComponent(state.tab)}`);
    return render();
  }
  if (target.dataset.matrixRound) {
    state.matrixRound = Number(target.dataset.matrixRound);
    return render();
  }
  if (target.dataset.modal) {
    modal = target.dataset.modal as "create" | "join";
    return render();
  }
  if (target.dataset.action === "close-modal") {
    modal = null;
    return render();
  }
  if (target.dataset.copyCode) {
    event.preventDefault();
    event.stopPropagation();
    await copyJoinCode(target.dataset.copyCode);
    return;
  }
});

async function copyJoinCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedJoinCode = code;
    render();
    window.setTimeout(() => {
      if (copiedJoinCode === code) {
        copiedJoinCode = "";
        render();
      }
    }, 1400);
  } catch {
    alert("Could not copy the join code.");
  }
}

document.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).classList.contains("modal-veil")) {
    modal = null;
    render();
  }
});

document.addEventListener("input", (event) => {
  const box = (event.target as HTMLElement).closest<HTMLInputElement>("[data-join-code-box]");
  if (!box) return;

  fillJoinCodeBoxes(box, box.value);
});

document.addEventListener("paste", (event) => {
  const box = (event.target as HTMLElement).closest<HTMLInputElement>("[data-join-code-box]");
  if (!box) return;

  event.preventDefault();
  fillJoinCodeBoxes(box, event.clipboardData?.getData("text") || "");
});

document.addEventListener("keydown", (event) => {
  const box = (event.target as HTMLElement).closest<HTMLInputElement>("[data-join-code-box]");
  if (!box) return;

  const form = box.closest<HTMLFormElement>("[data-group-form]");
  const boxes = form ? Array.from(form.querySelectorAll<HTMLInputElement>("[data-join-code-box]")) : [];
  const index = boxes.indexOf(box);

  if (event.key === "Backspace" && !box.value && index > 0) {
    boxes[index - 1]?.focus();
    boxes[index - 1]!.value = "";
    if (form) getJoinCodeFromForm(form);
  }

  if (event.key === "ArrowLeft" && index > 0) boxes[index - 1]?.focus();
  if (event.key === "ArrowRight" && index >= 0 && index < boxes.length - 1) boxes[index + 1]?.focus();
});

document.addEventListener("submit", async (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-group-form]");
  if (!form || !user?.id) return;
  event.preventDefault();
  void saveGroupOptimistically(form);
});

window.addEventListener("popstate", () => {
  const route = getRouteState();
  state.view = route.view;
  state.tab = route.tab;
  state.groupId = route.groupId;
  modal = null;
  updateDocumentTitle();
  render();
});

async function saveJoker(roundNumber: number | null) {
  try {
    await runApiMutation(["joker-rounds", "save"], "/api/joker-rounds", { userId: user!.id, roundNumber });
    await refreshAppState();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to save joker round");
  }
}
