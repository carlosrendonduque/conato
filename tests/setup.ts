/**
 * Test environment.
 *
 * `src/lib/env.ts` validates the environment at import time and throws when
 * something is missing, so any module that transitively imports the database
 * client is unimportable without these. The values are syntactically valid
 * placeholders — no test here opens a connection or calls a provider.
 *
 * Individual tests may override a variable; they are responsible for
 * restoring it.
 */
process.env.CONATO_ACCESS_SECRET ??= "test-access-secret-not-a-real-one";
process.env.CONATO_COOKIE_SECRET ??= "test-cookie-secret-not-a-real-one";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
