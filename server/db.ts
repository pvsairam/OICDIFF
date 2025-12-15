import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";

const { Pool } = pg;

// Use NEON_DATABASE_URL for testing, fall back to DATABASE_URL
const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Enable SSL for Neon/external databases (detected by hostname or sslmode in URL)
const needsSSL = connectionString.includes('neon.tech') || 
                 connectionString.includes('sslmode=require') ||
                 process.env.VERCEL === '1';

export const pool = new Pool({ 
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});
export const db = drizzle(pool, { schema });
