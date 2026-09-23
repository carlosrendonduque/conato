import { z } from "zod";

/**
 * Validación estricta de variables de entorno server-side.
 * Importar este módulo desde código de servidor falla rápido si falta algo.
 */
/**
 * Valores de marcador que vienen en `.env.example`. Un secreto sin cambiar
 * es equivalente a no tener secreto, y `.min(16)` no lo detecta porque los
 * placeholders son largos. Rechazarlos al arrancar evita desplegar abierto.
 */
const PLACEHOLDER_SECRETS = new Set([
  "cambiar-por-un-secreto-largo-y-aleatorio",
  "cambiar-por-otro-secreto-largo-y-aleatorio",
  "change-me-to-a-long-random-secret",
  "change-me-to-another-long-random-secret",
]);

/**
 * Secreto utilizable: suficientemente largo, no un placeholder, y con
 * variedad de caracteres (descarta "aaaaaaaaaaaaaaaaaa" y similares).
 */
const secret = (name: string) =>
  z
    .string()
    .min(16, `${name} must be at least 16 characters`)
    .refine((v) => !PLACEHOLDER_SECRETS.has(v), {
      message: `${name} is still the example placeholder — set a real secret`,
    })
    .refine((v) => new Set(v).size >= 8, {
      message: `${name} has too little variety to be a secret`,
    });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  CONATO_ACCESS_SECRET: secret("CONATO_ACCESS_SECRET"),
  CONATO_COOKIE_SECRET: secret("CONATO_COOKIE_SECRET"),

  DATABASE_URL: z.string().url(),

  // Sin ella no hay asistencia de escritura; todo lo demás funciona.
  ANTHROPIC_API_KEY: z.string().optional(),

  // Voyage AI: provider de embeddings para RAG. Sin esta key, el reindex
  // y el retrieval fallan silenciosamente (RAG opcional desde el runtime).
  VOYAGE_API_KEY: z.string().optional(),

  // Token para acceso público (sin auth gate) a `/editor/<token>/...`,
  // donde lectores externos leen los archivos marcados como
  // `share_external`. Sin esta env var, /editor devuelve 404.
  CONATO_EDITOR_TOKEN: z.string().min(8).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type Env = typeof env;
