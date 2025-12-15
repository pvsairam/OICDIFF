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

// Optimized for serverless: small pool, fast timeouts
export const pool = new Pool({ 
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 1, // Serverless: one connection per function instance
  connectionTimeoutMillis: 5000, // 5 second connection timeout
  idleTimeoutMillis: 10000, // Close idle connections quickly
});
export const db = drizzle(pool, { schema });
