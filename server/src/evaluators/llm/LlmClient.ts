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

export class AnthropicClient implements LlmClient {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-sonnet-5',
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {
    this.id = `anthropic:${model}`;
    this.label = `Anthropic ${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
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

    const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text.trim()) throw new EvaluationFailedError('Anthropic API returned an empty response.');
    return text;
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
