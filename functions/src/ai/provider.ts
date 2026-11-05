// Provider abstraction (PRD section 7): the app talks to ChatModel, so the model or vendor
// can change (Claude, Gemini, OpenAI) without rewriting the engine. Keys stay in Secret Manager.
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ANSWER_MODEL, FAST_MODEL, secretValue } from "../lib/params";

export interface ChatRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature?: number;
}
export interface ChatResult { text: string; inputTokens: number; outputTokens: number; model: string }
export interface ChatModel { id: string; complete(r: ChatRequest): Promise<ChatResult> }

class ClaudeModel implements ChatModel {
  constructor(public id: string, private client: Anthropic) {}
  async complete(r: ChatRequest): Promise<ChatResult> {
    const msg = await this.client.messages.create({
      model: this.id, max_tokens: r.maxTokens, temperature: r.temperature ?? 0,
      system: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }],
      messages: r.messages,
    });
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    return { text, inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0), outputTokens: msg.usage.output_tokens, model: this.id };
  }
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  const key = secretValue(ANTHROPIC_API_KEY);
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  if (!client) client = new Anthropic({ apiKey: key, maxRetries: 3 });
  return client;
}

/** The strong model for answers. */
export const answerModel = (): ChatModel => new ClaudeModel(ANSWER_MODEL.value(), anthropic());
/** The cheaper model for reranking and classification. */
export const fastModel = (): ChatModel => new ClaudeModel(FAST_MODEL.value(), anthropic());
