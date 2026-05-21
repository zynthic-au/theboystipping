import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = getMigrationDatabaseUrl();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

function getMigrationDatabaseUrl() {
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (directUrl) return directUrl;

  const pooledUrl = process.env.DATABASE_URL ?? "";
  if (!pooledUrl) return "";

  try {
    const url = new URL(pooledUrl);
    url.hostname = url.hostname.replace("-pooler.", ".");
    if (url.searchParams.get("sslmode") === "require") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return pooledUrl;
  }
}
