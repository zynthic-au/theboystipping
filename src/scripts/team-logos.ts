const NRL_THEME_KEYS: Record<string, string> = {
  BRI: "broncos",
  BUL: "bulldogs",
  CBY: "bulldogs",
  COW: "cowboys",
  NQL: "cowboys",
  DOL: "dolphins",
  DRA: "dragons",
  STI: "dragons",
  EEL: "eels",
  PAR: "eels",
  KNI: "knights",
  NEW: "knights",
  MAN: "sea-eagles",
  STO: "storm",
  MEL: "storm",
  PAN: "panthers",
  PEN: "panthers",
  RAI: "raiders",
  CBR: "raiders",
  ROO: "roosters",
  SYD: "roosters",
  SHA: "sharks",
  CRO: "sharks",
  SOU: "rabbitohs",
  TIT: "titans",
  GLD: "titans",
  WAR: "warriors",
  NZW: "warriors",
  WST: "wests-tigers",
};

function normalizeTeamCode(code: string) {
  return code.trim().toUpperCase();
}

export function teamLogoSrc(code: string) {
  const normalized = normalizeTeamCode(code);
  if (NRL_THEME_KEYS[normalized]) return `/teams/${normalized}.svg`;
  return null;
}

export function teamLogo(code: string) {
  const normalized = normalizeTeamCode(code);
  const src = teamLogoSrc(normalized);
  if (src) {
    return `<span class="team-logo-wrap"><img class="team-logo" src="${src}" alt="" width="44" height="44" loading="lazy" decoding="async" aria-hidden="true"></span>`;
  }

  return `<span class="team-logo-wrap"><span class="team-logo-fallback" aria-hidden="true">${normalized.slice(0, 3)}</span></span>`;
}
