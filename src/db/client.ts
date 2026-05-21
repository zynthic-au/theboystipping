import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export function getDatabaseUrl() {
  const databaseUrl = import.meta.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.");
  }

  return databaseUrl;
}

export function getDb() {
  const sql = neon(getDatabaseUrl());
  return drizzle(sql, { schema });
}
