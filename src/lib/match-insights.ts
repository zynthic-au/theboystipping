import {
  canonicalTeamCode,
  fixtureNameToCode,
  getNrlTeam,
  matchupKey,
  oddsNameMatches,
} from "./nrl-teams";

export type H2HMatch = {
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
};

export type BookmakerOdds = {
  bookmaker: string;
  home: number;
  away: number;
};

export type MatchInsight = {
  history: H2HMatch[];
  odds: BookmakerOdds[];
  oddsAvailable: boolean;
};

type Cached<T> = { expiresAt: number; value: T };

type FixtureMatch = {
  date: string;
  homeCode: string;
  awayCode: string;
  homeScore: number;
  awayScore: number;
};

type FixtureDownloadMatch = {
  DateUtc: string;
  HomeTeam: string;
  AwayTeam: string;
  HomeTeamScore: number | null;
  AwayTeamScore: number | null;
};

const H2H_CACHE_TTL_MS = 6 * 60 * 60_000;
const SEASON_CACHE_TTL_MS = 6 * 60 * 60_000;
const ODDS_CACHE_TTL_MS = 4 * 60 * 60_000;
const PREFERRED_BOOKMAKERS = ["Sportsbet", "TAB", "Ladbrokes", "Neds", "PointsBet", "Betfair", "Unibet"];

const h2hCache = new Map<string, Cached<H2HMatch[]>>();
const seasonCache = new Map<number, Cached<FixtureMatch[]>>();
let oddsCache: Cached<OddsSnapshot[]> | null = null;

type OddsSnapshot = {
  homeTeam: string;
  awayTeam: string;
  bookmakers: BookmakerOdds[];
};

export async function getMatchInsights(home: string, away: string): Promise<MatchInsight> {
  const [history, odds] = await Promise.all([
    getHeadToHeadHistory(home, away),
    getOddsForMatchup(home, away),
  ]);

  return {
    history,
    odds: odds.bookmakers,
    oddsAvailable: odds.available,
  };
}

export async function getMatchInsightsBatch(matchups: Array<{ home: string; away: string }>) {
  const unique = new Map<string, { home: string; away: string }>();
  for (const matchup of matchups) {
    unique.set(matchupKey(matchup.home, matchup.away), matchup);
  }

  const entries = await Promise.all(
    Array.from(unique.values()).map(async (matchup) => [
      matchupKey(matchup.home, matchup.away),
      await getMatchInsights(matchup.home, matchup.away),
    ] as const),
  );

  return Object.fromEntries(entries);
}

async function getHeadToHeadHistory(home: string, away: string, limit = 5) {
  const key = matchupKey(home, away);
  const cached = h2hCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const homeCode = canonicalTeamCode(home);
  const awayCode = canonicalTeamCode(away);
  if (!getNrlTeam(homeCode) || !getNrlTeam(awayCode)) return [];

  const currentYear = new Date().getFullYear();
  const seasons = Array.from({ length: 8 }, (_, index) => currentYear - index);
  const seasonResults = await Promise.all(seasons.map((season) => loadSeasonMatches(season)));

  const matches: H2HMatch[] = [];
  for (const seasonMatches of seasonResults) {
    for (const item of seasonMatches) {
      const isMatchup =
        (item.homeCode === homeCode && item.awayCode === awayCode)
        || (item.homeCode === awayCode && item.awayCode === homeCode);

      if (!isMatchup) continue;

      matches.push({
        date: item.date,
        home: item.homeCode === homeCode ? homeCode : awayCode,
        away: item.homeCode === homeCode ? awayCode : homeCode,
        homeScore: item.homeCode === homeCode ? item.homeScore : item.awayScore,
        awayScore: item.homeCode === homeCode ? item.awayScore : item.homeScore,
      });
    }
  }

  const sorted = matches
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, limit);

  h2hCache.set(key, { expiresAt: Date.now() + H2H_CACHE_TTL_MS, value: sorted });
  return sorted;
}

async function loadSeasonMatches(season: number) {
  const cached = seasonCache.get(season);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `https://fixturedownload.com/feed/json/nrl-${season}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "TheBoysTipping/1.0" },
    });
    if (!response.ok) return [];

    const payload = await response.json() as FixtureDownloadMatch[];
    const matches = payload.flatMap((item) => {
      if (item.HomeTeamScore == null || item.AwayTeamScore == null) return [];

      const homeCode = fixtureNameToCode(item.HomeTeam);
      const awayCode = fixtureNameToCode(item.AwayTeam);
      if (!homeCode || !awayCode) return [];

      return [{
        date: item.DateUtc,
        homeCode,
        awayCode,
        homeScore: item.HomeTeamScore,
        awayScore: item.AwayTeamScore,
      }];
    });

    seasonCache.set(season, { expiresAt: Date.now() + SEASON_CACHE_TTL_MS, value: matches });
    return matches;
  } catch {
    return [];
  }
}

async function getOddsForMatchup(home: string, away: string) {
  const snapshots = await loadOddsSnapshots();
  const snapshot = snapshots.find((item) =>
    (oddsNameMatches(home, item.homeTeam) && oddsNameMatches(away, item.awayTeam))
    || (oddsNameMatches(home, item.awayTeam) && oddsNameMatches(away, item.homeTeam)),
  );

  if (!snapshot) {
    return { available: snapshots.length > 0, bookmakers: [] as BookmakerOdds[] };
  }

  const flipped = oddsNameMatches(home, snapshot.awayTeam) && oddsNameMatches(away, snapshot.homeTeam);
  const bookmakers = snapshot.bookmakers.map((item) => ({
    bookmaker: item.bookmaker,
    home: flipped ? item.away : item.home,
    away: flipped ? item.home : item.away,
  }));

  return { available: true, bookmakers: sortBookmakers(bookmakers) };
}

async function loadOddsSnapshots() {
  if (oddsCache && oddsCache.expiresAt > Date.now()) return oddsCache.value;

  const apiKey = getOddsApiKey();
  if (!apiKey) {
    oddsCache = { expiresAt: Date.now() + ODDS_CACHE_TTL_MS, value: [] };
    return [];
  }

  const url = new URL("https://api.the-odds-api.com/v4/sports/rugbyleague_nrl/odds");
  url.searchParams.set("regions", "au");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      oddsCache = { expiresAt: Date.now() + 5 * 60_000, value: [] };
      return [];
    }

    const payload = await response.json() as OddsApiEvent[];
    const snapshots = payload.map(parseOddsEvent).filter(Boolean) as OddsSnapshot[];
    oddsCache = { expiresAt: Date.now() + ODDS_CACHE_TTL_MS, value: snapshots };
    return snapshots;
  } catch {
    oddsCache = { expiresAt: Date.now() + 5 * 60_000, value: [] };
    return [];
  }
}

type OddsApiEvent = {
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
};

function parseOddsEvent(event: OddsApiEvent): OddsSnapshot | null {
  const bookmakers: BookmakerOdds[] = [];

  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((item) => item.key === "h2h");
    if (!market) continue;

    const home = market.outcomes.find((item) => item.name === event.home_team)?.price;
    const away = market.outcomes.find((item) => item.name === event.away_team)?.price;
    if (!home || !away) continue;

    bookmakers.push({
      bookmaker: bookmaker.title,
      home,
      away,
    });
  }

  if (!bookmakers.length) return null;

  return {
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers: sortBookmakers(bookmakers),
  };
}

function getOddsApiKey() {
  if (typeof import.meta !== "undefined" && import.meta.env?.THE_ODDS_API_KEY) {
    return import.meta.env.THE_ODDS_API_KEY;
  }

  return process.env.THE_ODDS_API_KEY ?? "";
}

function sortBookmakers(bookmakers: BookmakerOdds[]) {
  return [...bookmakers].sort((left, right) => {
    const leftRank = PREFERRED_BOOKMAKERS.indexOf(left.bookmaker);
    const rightRank = PREFERRED_BOOKMAKERS.indexOf(right.bookmaker);
    const safeLeft = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
    const safeRight = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return left.bookmaker.localeCompare(right.bookmaker);
  }).slice(0, 4);
}
