import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";

// prepare: false es obligatorio cuando DATABASE_URL apunta al pooler de Neon
// (PgBouncer en modo transaction no soporta prepared statements). En Postgres
// local la diferencia de rendimiento es despreciable para este uso.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient);
export type Db = typeof db;
