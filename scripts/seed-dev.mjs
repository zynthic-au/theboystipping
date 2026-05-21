import "dotenv/config";
import pg from "pg";

const { Client } = pg;

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed while NODE_ENV=production.");
}

if (process.env.ALLOW_DEV_SEED !== "true") {
  throw new Error("Refusing to seed without ALLOW_DEV_SEED=true. Use npm run db:seed:dev.");
}

const databaseUrl = getMigrationDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL is required to seed dev data.");

const client = new Client({ connectionString: databaseUrl });
const season = 2026;

const teams = [
  ["BRI", "Broncos", "Brisbane"],
  ["CBR", "Raiders", "Canberra"],
  ["CBY", "Bulldogs", "Canterbury-Bankstown"],
  ["CRO", "Sharks", "Cronulla-Sutherland"],
  ["DOL", "Dolphins", "Moreton Bay"],
  ["GLD", "Titans", "Gold Coast"],
  ["MAN", "Sea Eagles", "Manly Warringah"],
  ["MEL", "Storm", "Melbourne"],
  ["NEW", "Knights", "Newcastle"],
  ["NQL", "Cowboys", "North Queensland"],
  ["PAR", "Eels", "Parramatta"],
  ["PEN", "Panthers", "Penrith"],
  ["SOU", "Rabbitohs", "South Sydney"],
  ["STI", "Dragons", "St George Illawarra"],
  ["SYD", "Roosters", "Sydney"],
  ["NZW", "Warriors", "New Zealand"],
  ["WST", "Wests Tigers", "Wests"],
];

const users = [
  ["dev-user-1", "Tommy Tips", "Tommy Tips", "TT", "BRI"],
  ["dev-user-2", "Macca", "Chris Mack", "CM", "MEL"],
  ["dev-user-3", "Big Red", "Ryan O'Connor", "RO", "PEN"],
  ["dev-user-4", "Damo", "Damien Lee", "DL", "NZW"],
  ["dev-user-5", "Juzzy", "Justin Smith", "JS", "CBY"],
  ["dev-user-6", "The Accountant", "Sam Patel", "SP", "SYD"],
];

const rounds = [
  { n: 1, label: "Round 1", status: "done", closesAt: "2026-03-06T08:00:00.000Z" },
  { n: 2, label: "Round 2", status: "done", closesAt: "2026-03-13T08:00:00.000Z" },
  { n: 3, label: "Round 3", status: "open", closesAt: "2026-03-20T08:00:00.000Z" },
  { n: 4, label: "Round 4", status: "upcoming", closesAt: "2026-03-27T08:00:00.000Z" },
];

const pairings = [
  [["BRI", "MEL"], ["PEN", "SYD"], ["NZW", "CBR"], ["CBY", "PAR"], ["CRO", "SOU"], ["MAN", "NEW"], ["NQL", "GLD"], ["DOL", "STI"]],
  [["MEL", "PEN"], ["SYD", "BRI"], ["CBR", "CBY"], ["PAR", "CRO"], ["SOU", "MAN"], ["NEW", "NQL"], ["GLD", "DOL"], ["WST", "NZW"]],
  [["BRI", "PEN"], ["MEL", "NZW"], ["SYD", "CBY"], ["CBR", "CRO"], ["PAR", "MAN"], ["SOU", "NQL"], ["NEW", "DOL"], ["GLD", "WST"]],
  [["PEN", "NZW"], ["BRI", "CBY"], ["MEL", "CRO"], ["SYD", "MAN"], ["CBR", "NQL"], ["PAR", "DOL"], ["SOU", "WST"], ["NEW", "STI"]],
];

const groups = [
  ["The Pub Crew", "Friday night arguments, Monday morning bragging rights.", "PUB123", "dev-user-1"],
  ["The Boys League", "A proper mates comp with no mercy for late tips.", "BOYS24", "dev-user-2"],
  ["Workplace Ladder", "Office tipping without the awkward spreadsheet.", "WORK24", "dev-user-6"],
];

try {
  await client.connect();
  await seedTeams();
  await seedUsers();
  const roundIds = await seedRounds();
  const matchIds = await seedMatches(roundIds);
  const groupIds = await seedGroups();
  await seedMemberships(groupIds);
  await seedTips(matchIds);
  await seedJokers(roundIds);
  console.log("Seeded development data.");
  console.log("Join codes: PUB123, BOYS24, WORK24");
} finally {
  await client.end();
}

async function seedTeams() {
  for (const [code, name, city] of teams) {
    await client.query(
      `insert into teams (code, name, city)
       values ($1, $2, $3)
       on conflict (code) do update set name = excluded.name, city = excluded.city`,
      [code, name, city],
    );
  }
}

async function seedUsers() {
  for (const [userId, displayName, fullName, initials, favouriteTeamCode] of users) {
    await client.query(
      `insert into user_profiles (user_id, display_name, full_name, initials, favourite_team_code)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set
         display_name = excluded.display_name,
         full_name = excluded.full_name,
         initials = excluded.initials,
         favourite_team_code = excluded.favourite_team_code,
         updated_at = now()`,
      [userId, displayName, fullName, initials, favouriteTeamCode],
    );
  }
}

async function seedRounds() {
  const ids = new Map();
  for (const round of rounds) {
    const result = await client.query(
      `insert into rounds (round_key, season, round_number, label, status, closes_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (season, round_number) do update set
         round_key = excluded.round_key,
         label = excluded.label,
         status = excluded.status,
         closes_at = excluded.closes_at
       returning id`,
      [`${season}-r${round.n}`, season, round.n, round.label, round.status, round.closesAt],
    );
    ids.set(round.n, result.rows[0].id);
  }
  return ids;
}

async function seedMatches(roundIds) {
  const ids = new Map();
  for (const round of rounds) {
    const roundPairs = pairings[round.n - 1];
    for (const [index, [home, away]] of roundPairs.entries()) {
      const matchNumber = index + 1;
      const externalId = `r${round.n}m${matchNumber}`;
      const startsAt = new Date(Date.parse(round.closesAt) + index * 3 * 60 * 60 * 1000).toISOString();
      const winner = round.status === "done" ? (index % 3 === 0 ? away : home) : null;
      const result = await client.query(
        `insert into matches (external_id, round_id, home_team_code, away_team_code, winner_team_code, starts_at, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (external_id) do update set
           round_id = excluded.round_id,
           home_team_code = excluded.home_team_code,
           away_team_code = excluded.away_team_code,
           winner_team_code = excluded.winner_team_code,
           starts_at = excluded.starts_at,
           sort_order = excluded.sort_order
         returning id`,
        [externalId, roundIds.get(round.n), home, away, winner, startsAt, matchNumber],
      );
      ids.set(externalId, { id: result.rows[0].id, home, away, roundNumber: round.n, matchNumber });
    }
  }
  return ids;
}

async function seedGroups() {
  const ids = new Map();
  for (const [name, description, joinCode, createdByUserId] of groups) {
    const result = await client.query(
      `insert into tipping_groups (name, description, join_code, created_by_user_id)
       values ($1, $2, $3, $4)
       on conflict (join_code) do update set
         name = excluded.name,
         description = excluded.description,
         created_by_user_id = excluded.created_by_user_id
       returning id`,
      [name, description, joinCode, createdByUserId],
    );
    ids.set(joinCode, result.rows[0].id);
  }
  return ids;
}

async function seedMemberships(groupIds) {
  const memberships = [
    ["PUB123", "dev-user-1"], ["PUB123", "dev-user-2"], ["PUB123", "dev-user-3"], ["PUB123", "dev-user-4"],
    ["BOYS24", "dev-user-1"], ["BOYS24", "dev-user-2"], ["BOYS24", "dev-user-3"], ["BOYS24", "dev-user-5"],
    ["WORK24", "dev-user-2"], ["WORK24", "dev-user-4"], ["WORK24", "dev-user-5"], ["WORK24", "dev-user-6"],
  ];

  for (const [joinCode, userId] of memberships) {
    await client.query(
      `insert into group_members (group_id, user_id)
       values ($1, $2)
       on conflict do nothing`,
      [groupIds.get(joinCode), userId],
    );
  }
}

async function seedTips(matchIds) {
  for (const [userIndex, [userId]] of users.entries()) {
    for (const [externalId, match] of matchIds) {
      if (match.roundNumber > 3) continue;
      const pickedTeamCode = (userIndex + match.matchNumber + match.roundNumber) % 2 === 0 ? match.home : match.away;
      await client.query(
        `insert into tips (user_id, match_id, picked_team_code)
         values ($1, $2, $3)
         on conflict (user_id, match_id) do update set
           picked_team_code = excluded.picked_team_code,
           updated_at = now()`,
        [userId, match.id, pickedTeamCode],
      );
    }
  }
}

async function seedJokers(roundIds) {
  const jokers = [
    ["dev-user-1", 1, true],
    ["dev-user-2", 2, true],
    ["dev-user-3", 3, false],
    ["dev-user-5", 3, false],
  ];

  for (const [userId, roundNumber, isLocked] of jokers) {
    await client.query(
      `insert into joker_rounds (user_id, round_id, is_locked)
       values ($1, $2, $3)
       on conflict (user_id, round_id) do update set is_locked = excluded.is_locked`,
      [userId, roundIds.get(roundNumber), isLocked],
    );
  }
}

function getMigrationDatabaseUrl() {
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (directUrl) return directUrl;

  const pooledUrl = process.env.DATABASE_URL ?? "";
  if (!pooledUrl) return "";

  const url = new URL(pooledUrl);
  url.hostname = url.hostname.replace("-pooler.", ".");
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
