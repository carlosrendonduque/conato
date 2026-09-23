import { PROVIDER_IDS, type ProviderId } from "./providers";

/**
 * Las cinco operaciones de v1. La arquitectura del comando es un patrón único
 * "operación + ubicación + contexto", no cinco endpoints distintos.
 */
export const OPERATIONS = [
  "expand",
  "contract",
  "rewrite",
  "continue",
  "free_prompt",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export interface SelectionRange {
  from: number;
  to: number;
}

export interface InvokeRequestBody {
  fileId: string;
  operation: Operation;
  userPrompt?: string;
  selection?: { text: string; range: SelectionRange };
  cursorPosition?: number;
  provider?: ProviderId;
  model?: string;
}

export interface InvokeResponseBody {
  invocationId: string;
  responseText: string;
  provider: ProviderId;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export { PROVIDER_IDS };
