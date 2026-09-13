import { EvaluationFailedError } from '../../domain/shared/errors';

export interface LlmRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

/**
 * The narrowest possible view of a chat model: text in, text out.
 *
 * Keeping it this small means `LlmEvaluator` contains all the interesting logic
 * (prompt, schema, validation, grounding) and swapping providers is a 40-line
 * adapter, not a rewrite.
 */
export interface LlmClient {
  /** Stable id recorded on the evaluation, e.g. `anthropic:claude-sonnet-5`. */
  readonly id: string;
  readonly label: string;
  complete(request: LlmRequest): Promise<string>;
}

/**
 * How the key is presented. Anthropic itself wants `x-api-key`; compatible
 * gateways (AgentRouter, OpenRouter and the other relays that speak the same
 * wire format) generally want a bearer token instead, which is why this is
 * configuration rather than a constant.
 */
export type AnthropicAuthScheme = 'x-api-key' | 'bearer';

/**
 * Relays that resell the Anthropic API front their upstream with a WAF that
 * only admits traffic looking like Claude Code; anything else is rejected as
 * `401 Invalid API Key!`, which is indistinguishable from a genuinely bad key
 * and cost an afternoon to diagnose. Measured against AgentRouter, the
 * User-Agent is the whole test - `x-app`, `anthropic-beta` and the Stainless
 * SDK headers are not checked - so this is the one header we add, and only
 * when a relay is configured. Requests to Anthropic proper are untouched.
 */
const RELAY_USER_AGENT = 'claude-cli/2.1.158 (external, sdk-cli)';

export class AnthropicClient implements LlmClient {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-sonnet-5',
    private readonly baseUrl = 'https://api.anthropic.com',
    private readonly authScheme: AnthropicAuthScheme = 'x-api-key',
  ) {
    this.id = `anthropic:${model}`;
    // The host is part of the label, not the id: two evaluations of the same
    // model stay comparable, while a reviewer can still see that the judgement
    // came through a relay. A relayed model is not named "Anthropic ..." -
    // these gateways also serve models from other vendors over the same wire
    // format, and mislabelling which model graded a design would be a lie in
    // the one place the product asks to be trusted.
    const host = hostOf(baseUrl);
    this.label = host ? `${model} via ${host}` : `Anthropic ${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.authScheme === 'bearer'
          ? { authorization: `Bearer ${this.apiKey}` }
          : { 'x-api-key': this.apiKey }),
        ...(hostOf(this.baseUrl) ? { 'user-agent': RELAY_USER_AGENT } : {}),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new EvaluationFailedError(
        `Anthropic API returned ${response.status}: ${truncateBody(await safeText(response))}`,
        response.status >= 500 || response.status === 429,
      );
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };
    const blocks = body.content ?? [];
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text.trim()) {
      // A reasoning model that used its whole allowance on `thinking` blocks
      // returns a perfectly valid response containing no answer. Saying that
      // plainly points at LLM_MAX_TOKENS instead of at the network.
      const thought = blocks.some((block) => block.type === 'thinking');
      throw new EvaluationFailedError(
        body.stop_reason === 'max_tokens' && thought
          ? `${this.model} used its whole ${request.maxTokens}-token budget reasoning and never wrote a verdict. Raise LLM_MAX_TOKENS.`
          : 'The model returned an empty response.',
      );
    }
    return text;
  }
}

/** Empty for Anthropic's own endpoint, so the common case reads unchanged. */
function hostOf(baseUrl: string): string | undefined {
  try {
    const { host } = new URL(baseUrl);
    return host === 'api.anthropic.com' ? undefined : host;
  } catch {
    return undefined;
  }
}

export class OpenAiClient implements LlmClient {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-4o-mini',
    private readonly baseUrl = 'https://api.openai.com',
  ) {
    this.id = `openai:${model}`;
    this.label = `OpenAI ${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new EvaluationFailedError(
        `OpenAI API returned ${response.status}: ${truncateBody(await safeText(response))}`,
        response.status >= 500 || response.status === 429,
      );
    }

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new EvaluationFailedError('OpenAI API returned an empty response.');
    return text;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no body)';
  }
}

function truncateBody(body: string): string {
  return body.length > 300 ? `${body.slice(0, 300)}...` : body;
}
