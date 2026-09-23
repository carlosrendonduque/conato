import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Proveedores LLM soportados.
 *
 * v0.1 sirve solo a Anthropic: es el único que está verificado de punta a
 * punta contra la API real. La indirección se mantiene a propósito —
 * agregar un proveedor es añadir su id aquí, una entrada en `FACTORIES` y
 * su default en `DEFAULT_MODELS`, más exponer su API key vía env. Es
 * configuración, no arquitectura.
 */
export const PROVIDER_IDS = ["anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Modelo por defecto de cada proveedor. El usuario puede pedir otro modelo
 * por invocación; este es el punto de partida.
 *
 * Esta es la única definición de los defaults: la ruta de invocación la
 * importa en lugar de mantener su propia copia, para que el modelo que se
 * registra en la DB sea siempre el que realmente respondió.
 */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5",
};

const FACTORIES: Record<ProviderId, (model: string) => LanguageModel> = {
  anthropic: (model) => anthropic(model),
};

/**
 * Resuelve el modelo a usar. Si el llamador no especifica uno, usa el
 * default del proveedor.
 */
export function getModel(provider: ProviderId, model?: string): LanguageModel {
  return FACTORIES[provider](model ?? DEFAULT_MODELS[provider]);
}
