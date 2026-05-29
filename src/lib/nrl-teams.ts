export type NrlTeamMeta = {
  code: string;
  fixtureName: string;
  oddsNames: string[];
};

export const NRL_TEAMS: Record<string, NrlTeamMeta> = {
  BRI: { code: "BRI", fixtureName: "Broncos", oddsNames: ["Brisbane Broncos", "Brisbane"] },
  BUL: { code: "BUL", fixtureName: "Bulldogs", oddsNames: ["Canterbury Bulldogs", "Canterbury-Bankstown Bulldogs", "Bulldogs"] },
  CBY: { code: "BUL", fixtureName: "Bulldogs", oddsNames: ["Canterbury Bulldogs", "Canterbury-Bankstown Bulldogs", "Bulldogs"] },
  COW: { code: "COW", fixtureName: "Cowboys", oddsNames: ["North Queensland Cowboys", "North Qld Cowboys", "Cowboys"] },
  NQL: { code: "COW", fixtureName: "Cowboys", oddsNames: ["North Queensland Cowboys", "North Qld Cowboys", "Cowboys"] },
  DOL: { code: "DOL", fixtureName: "Dolphins", oddsNames: ["Dolphins", "The Dolphins", "Redcliffe Dolphins"] },
  DRA: { code: "DRA", fixtureName: "Dragons", oddsNames: ["St George Illawarra Dragons", "St George-Illawarra Dragons", "Dragons"] },
  STI: { code: "DRA", fixtureName: "Dragons", oddsNames: ["St George Illawarra Dragons", "St George-Illawarra Dragons", "Dragons"] },
  EEL: { code: "EEL", fixtureName: "Eels", oddsNames: ["Parramatta Eels", "Eels"] },
  PAR: { code: "EEL", fixtureName: "Eels", oddsNames: ["Parramatta Eels", "Eels"] },
  KNI: { code: "KNI", fixtureName: "Knights", oddsNames: ["Newcastle Knights", "Knights"] },
  NEW: { code: "KNI", fixtureName: "Knights", oddsNames: ["Newcastle Knights", "Knights"] },
  MAN: { code: "MAN", fixtureName: "Sea Eagles", oddsNames: ["Manly Sea Eagles", "Manly-Warringah Sea Eagles", "Sea Eagles"] },
  PAN: { code: "PAN", fixtureName: "Panthers", oddsNames: ["Penrith Panthers", "Panthers"] },
  PEN: { code: "PAN", fixtureName: "Panthers", oddsNames: ["Penrith Panthers", "Panthers"] },
  RAI: { code: "RAI", fixtureName: "Raiders", oddsNames: ["Canberra Raiders", "Raiders"] },
  CBR: { code: "RAI", fixtureName: "Raiders", oddsNames: ["Canberra Raiders", "Raiders"] },
  ROO: { code: "ROO", fixtureName: "Roosters", oddsNames: ["Sydney Roosters", "Roosters"] },
  SYD: { code: "ROO", fixtureName: "Roosters", oddsNames: ["Sydney Roosters", "Roosters"] },
  SHA: { code: "SHA", fixtureName: "Sharks", oddsNames: ["Cronulla Sharks", "Sharks"] },
  CRO: { code: "SHA", fixtureName: "Sharks", oddsNames: ["Cronulla Sharks", "Sharks"] },
  SOU: { code: "SOU", fixtureName: "Rabbitohs", oddsNames: ["South Sydney Rabbitohs", "Rabbitohs"] },
  STO: { code: "STO", fixtureName: "Storm", oddsNames: ["Melbourne Storm", "Storm"] },
  MEL: { code: "STO", fixtureName: "Storm", oddsNames: ["Melbourne Storm", "Storm"] },
  TIT: { code: "TIT", fixtureName: "Titans", oddsNames: ["Gold Coast Titans", "Titans"] },
  GLD: { code: "TIT", fixtureName: "Titans", oddsNames: ["Gold Coast Titans", "Titans"] },
  WAR: { code: "WAR", fixtureName: "Warriors", oddsNames: ["Warriors", "New Zealand Warriors"] },
  NZW: { code: "WAR", fixtureName: "Warriors", oddsNames: ["Warriors", "New Zealand Warriors"] },
  WST: { code: "WST", fixtureName: "Wests Tigers", oddsNames: ["Wests Tigers"] },
};

const FIXTURE_NAME_TO_CODE = Object.values(NRL_TEAMS).reduce<Record<string, string>>((lookup, team) => {
  lookup[team.fixtureName] = team.code;
  return lookup;
}, {});

export function normalizeTeamCode(code: string) {
  return code.trim().toUpperCase();
}

export function getNrlTeam(code: string) {
  return NRL_TEAMS[normalizeTeamCode(code)] ?? null;
}

export function canonicalTeamCode(code: string) {
  return getNrlTeam(code)?.code ?? normalizeTeamCode(code);
}

export function fixtureNameToCode(name: string) {
  return FIXTURE_NAME_TO_CODE[name.trim()] ?? null;
}

export function matchupKey(home: string, away: string) {
  return `${canonicalTeamCode(home)}:${canonicalTeamCode(away)}`;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function namesMatch(candidate: string, aliases: string[]) {
  const normalized = normalizeName(candidate);
  return aliases.some((alias) => {
    const target = normalizeName(alias);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });
}

export function oddsNameMatches(code: string, candidate: string) {
  const team = getNrlTeam(code);
  if (!team) return false;
  return namesMatch(candidate, team.oddsNames);
}
