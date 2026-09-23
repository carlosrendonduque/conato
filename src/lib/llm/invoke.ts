import { generateText, type ModelMessage } from "ai";
import { DEFAULT_MODELS, getModel, type ProviderId } from "./providers";

/**
 * Punto de entrada único para invocar a un LLM.
 * El llamador no necesita saber qué proveedor está detrás — solo elige `provider`.
 *
 * Esta es la frontera intercambiable: cuando agreguemos más operaciones,
 * streaming, tool use, o más proveedores, todo pasa por esta firma.
 */
export interface InvokeOptions {
  provider: ProviderId;
  /** Modelo concreto. Si se omite, el default del proveedor. */
  model?: string;
  system: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface InvokeResult {
  text: string;
  provider: ProviderId;
  /** El modelo que realmente respondió. */
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export async function invoke(options: InvokeOptions): Promise<InvokeResult> {
  const modelId = options.model ?? DEFAULT_MODELS[options.provider];
  const model = getModel(options.provider, modelId);

  const result = await generateText({
    model,
    system: options.system,
    messages: options.messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxOutputTokens !== undefined && {
      maxOutputTokens: options.maxOutputTokens,
    }),
  });

  return {
    text: result.text,
    provider: options.provider,
    model: modelId,
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
    },
  };
}
