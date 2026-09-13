import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import { EvaluationFailedError } from '../../src/domain/shared/errors';
import { Problem } from '../../src/domain/problem/Problem';
import { StructuredTextSubmission } from '../../src/domain/submission/StructuredTextSubmission';
import { HeuristicEvaluator } from '../../src/evaluators/heuristic/HeuristicEvaluator';
import { AnthropicClient, LlmClient, LlmRequest } from '../../src/evaluators/llm/LlmClient';
import { LlmEvaluator } from '../../src/evaluators/llm/LlmEvaluator';
import { isGrounded, parseVerdict } from '../../src/evaluators/llm/verdictParser';
import { PROBLEM_DEFINITIONS } from '../../src/infrastructure/content/problems';
import { STRONG_SUBMISSION, WEAK_SUBMISSION, strongContent, weakContent } from '../fixtures';

const rubric = Rubric.default();
const problem = Problem.from(PROBLEM_DEFINITIONS[0]);

function request(content: StructuredTextSubmission, attemptNumber = 1) {
  return {
    problem,
    document: content.toDesignDocument(),
    format: 'structured-text' as const,
    rubric,
    attemptNumber,
  };
}

describe('HeuristicEvaluator (demo mode)', () => {
  const evaluator = new HeuristicEvaluator();

  it('covers every rubric criterion', async () => {
    const verdict = await evaluator.evaluate(request(strongContent()));
    expect(verdict.criteria.map((c) => c.criterionKey).sort()).toEqual([...rubric.keys].sort());
  });

  it('quotes the learner instead of giving generic advice', async () => {
    const verdict = await evaluator.evaluate(request(strongContent()));
    const document = strongContent().toDesignDocument();
    for (const criterion of verdict.criteria) {
      expect(criterion.evidence.length).toBeGreaterThan(0);
      expect(isGrounded(criterion.evidence, document)).toBe(true);
      expect(criterion.suggestion).not.toMatch(/^use SOLID/i);
    }
  });

  it('separates a strong design from a weak one', async () => {
    const strong = await evaluator.evaluate(request(strongContent()));
    const weak = await evaluator.evaluate(request(weakContent()));

    const avg = (v: typeof strong) => v.criteria.reduce((a, c) => a + c.score.value, 0) / v.criteria.length;
    expect(avg(strong)).toBeGreaterThan(avg(weak) + 1.5);
  });

  it('names the overloaded class in the responsibilities feedback', async () => {
    const verdict = await evaluator.evaluate(request(weakContent()));
    const responsibilities = verdict.criteria.find((c) => c.criterionKey === 'class_responsibilities')!;
    expect(responsibilities.evidence).toContain('ParkingLot');
    expect(responsibilities.concern).toMatch(/duties/i);
  });

  it('is deterministic - the same submission always gets the same feedback', async () => {
    const a = await evaluator.evaluate(request(strongContent()));
    const b = await evaluator.evaluate(request(strongContent()));
    expect(a.criteria.map((c) => c.score.value)).toEqual(b.criteria.map((c) => c.score.value));
    expect(a.summary).toBe(b.summary);
  });

  it('never claims high confidence, because it cannot read intent', async () => {
    const verdict = await evaluator.evaluate(request(strongContent()));
    expect(verdict.criteria.every((c) => c.confidence !== 'high')).toBe(true);
  });

  it('mentions the carried focus so the learner sees the loop close', async () => {
    const verdict = await evaluator.evaluate({
      ...request(strongContent(), 2),
      previousFocus: 'Coupling and cohesion: state the direction of each dependency.',
    });
    expect(verdict.summary).toContain('Coupling and cohesion');
  });

  it('honours an abort signal so the coordinator can time it out', async () => {
    const slow = new HeuristicEvaluator({ delayMs: 5_000 });
    const controller = new AbortController();
    const promise = slow.evaluate({ ...request(strongContent()), signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });
});

describe('LLM verdict parsing (untrusted model output)', () => {
  const document = strongContent().toDesignDocument();

  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    summary: 'A reasonable summary.',
    next_focus: 'Split pricing out of ParkingLot.',
    criteria: rubric.keys.map((key) => ({
      criterion: key,
      score: 7,
      evidence: 'ParkingLot composes 1..* ParkingFloor',
      evidence_section: 'relationships',
      concern: 'A specific concern.',
      suggestion: 'A specific suggestion.',
      confidence: 'high',
    })),
    ...overrides,
  });

  it('parses a clean JSON response', () => {
    const verdict = parseVerdict(JSON.stringify(validPayload()), rubric, document);
    expect(verdict.criteria).toHaveLength(rubric.criteria.length);
    expect(verdict.nextFocus).toContain('pricing');
  });

  it('survives markdown fences and chatty preambles', () => {
    const raw = `Sure! Here is the evaluation:\n\`\`\`json\n${JSON.stringify(validPayload())}\n\`\`\`\nHope that helps.`;
    expect(() => parseVerdict(raw, rubric, document)).not.toThrow();
  });

  it('rejects output that is not JSON at all', () => {
    expect(() => parseVerdict('I think this design is quite good!', rubric, document)).toThrow(
      EvaluationFailedError,
    );
  });

  it('rejects a response that skips criteria instead of silently scoring fewer', () => {
    const partial = validPayload({ criteria: [{ criterion: 'extensibility', score: 6, evidence: 'x', suggestion: 'y' }] });
    expect(() => parseVerdict(JSON.stringify(partial), rubric, document)).toThrow(/missing usable feedback/i);
  });

  it('rejects criteria with no evidence rather than showing unfounded feedback', () => {
    const noEvidence = validPayload({
      criteria: rubric.keys.map((key) => ({
        criterion: key,
        score: 7,
        evidence: '',
        concern: 'c',
        suggestion: 's',
        confidence: 'high',
      })),
    });
    expect(() => parseVerdict(JSON.stringify(noEvidence), rubric, document)).toThrow(EvaluationFailedError);
  });

  it('ignores criteria the rubric does not define', () => {
    const extra = validPayload();
    (extra.criteria as unknown[]).push({
      criterion: 'vibes',
      score: 10,
      evidence: 'ParkingLot',
      suggestion: 'keep it up',
    });
    const verdict = parseVerdict(JSON.stringify(extra), rubric, document);
    expect(verdict.criteria.map((c) => c.criterionKey)).not.toContain('vibes');
  });

  it('clamps scores outside the 0-10 scale', () => {
    const wild = validPayload({
      criteria: rubric.keys.map((key) => ({
        criterion: key,
        score: 97,
        evidence: 'ParkingLot composes 1..* ParkingFloor',
        concern: 'c',
        suggestion: 's',
        confidence: 'high',
      })),
    });
    const verdict = parseVerdict(JSON.stringify(wild), rubric, document);
    expect(verdict.criteria.every((c) => c.score.value === 10)).toBe(true);
  });

  it('flags hallucinated evidence and drops its confidence instead of trusting it', () => {
    const invented = validPayload({
      criteria: rubric.keys.map((key) => ({
        criterion: key,
        score: 9,
        evidence: 'Your BlockchainOracleService synchronises quantum telemetry across regions',
        concern: 'c',
        suggestion: 's',
        confidence: 'high',
      })),
    });
    const verdict = parseVerdict(JSON.stringify(invented), rubric, document);
    expect(verdict.criteria.every((c) => c.grounded === false)).toBe(true);
    expect(verdict.criteria.every((c) => c.confidence === 'low')).toBe(true);
  });

  it('defaults an unrecognised confidence value to low', () => {
    const odd = validPayload({
      criteria: rubric.keys.map((key) => ({
        criterion: key,
        score: 7,
        evidence: 'ParkingLot composes 1..* ParkingFloor',
        concern: 'c',
        suggestion: 's',
        confidence: 'extremely sure',
      })),
    });
    const verdict = parseVerdict(JSON.stringify(odd), rubric, document);
    expect(verdict.criteria.every((c) => c.confidence === 'low')).toBe(true);
  });
});

describe('LlmEvaluator', () => {
  class RecordingClient implements LlmClient {
    readonly id = 'test:model';
    readonly label = 'Test model';
    lastRequest?: LlmRequest;
    constructor(private readonly response: string) {}
    async complete(request: LlmRequest): Promise<string> {
      this.lastRequest = request;
      return this.response;
    }
  }

  it('builds a prompt containing the rubric, the problem and the submission', async () => {
    const response = JSON.stringify({
      summary: 's',
      next_focus: 'f',
      criteria: rubric.keys.map((key) => ({
        criterion: key,
        score: 6,
        evidence: 'ParkingLot composes 1..* ParkingFloor',
        concern: 'c',
        suggestion: 'sug',
        confidence: 'medium',
      })),
    });
    const client = new RecordingClient(response);
    const evaluator = new LlmEvaluator(client);

    await evaluator.evaluate(request(strongContent()));

    expect(client.lastRequest?.system).toContain('class_responsibilities');
    expect(client.lastRequest?.system).toContain('Do not compute an overall score');
    expect(client.lastRequest?.user).toContain('Parking Lot');
    expect(client.lastRequest?.user).toContain('SpotAllocationStrategy');
  });

  it('exposes an evaluator id that records which model judged the attempt', () => {
    const evaluator = new LlmEvaluator(new RecordingClient('{}'));
    expect(evaluator.descriptor.id).toBe('llm:test:model');
    expect(evaluator.descriptor.kind).toBe('llm');
  });

  it('only claims support for formats it can actually read', () => {
    const evaluator = new LlmEvaluator(new RecordingClient('{}'));
    expect(evaluator.supports('structured-text')).toBe(true);
    expect(evaluator.supports('class-diagram')).toBe(false);
  });
});

describe('Grounding check', () => {
  const document = StructuredTextSubmission.create(STRONG_SUBMISSION).toDesignDocument();

  it('accepts a paraphrase that reuses the learner\'s vocabulary', () => {
    expect(isGrounded('SpotAllocationStrategy decides which free spot fits a vehicle', document)).toBe(true);
  });

  it('rejects a quote the learner never wrote', () => {
    expect(isGrounded('The KafkaEventBus replicates telemetry to Grafana dashboards', document)).toBe(false);
  });

  it('rejects empty evidence', () => {
    expect(isGrounded('   ', document)).toBe(false);
  });

  it('does not accidentally accept evidence from a different submission', () => {
    const weakDocument = StructuredTextSubmission.create(WEAK_SUBMISSION).toDesignDocument();
    expect(isGrounded('FeeCalculator turns duration and vehicle type into Money', weakDocument)).toBe(false);
  });
});


/**
 * The wire contract with Anthropic and with the compatible gateways that
 * resell it. Anthropic authenticates with `x-api-key`; relays such as
 * AgentRouter take a bearer token, and sending the wrong one is a 401 that
 * looks exactly like a bad key - so the choice is asserted here.
 */
describe('AnthropicClient authentication', () => {
  afterEach(() => vi.unstubAllGlobals());

  function captureHeaders(): { headers: () => Record<string, string>; url: () => string } {
    let seen: Record<string, string> = {};
    let seenUrl = '';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seen = (init.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return { headers: () => seen, url: () => seenUrl };
  }

  const call = (client: AnthropicClient) =>
    client.complete({ system: 's', user: 'u', maxTokens: 16 });

  it('sends x-api-key to Anthropic itself', async () => {
    const captured = captureHeaders();
    await call(new AnthropicClient('key-123', 'claude-sonnet-5'));
    expect(captured.url()).toBe('https://api.anthropic.com/v1/messages');
    expect(captured.headers()['x-api-key']).toBe('key-123');
    expect(captured.headers().authorization).toBeUndefined();
    // No relay is in play, so nothing claims to be Claude Code.
    expect(captured.headers()['user-agent']).toBeUndefined();
  });

  it('sends a bearer token when the gateway wants one', async () => {
    const captured = captureHeaders();
    await call(new AnthropicClient('key-123', 'glm-5.3', 'https://agentrouter.org', 'bearer'));
    expect(captured.url()).toBe('https://agentrouter.org/v1/messages');
    expect(captured.headers().authorization).toBe('Bearer key-123');
    expect(captured.headers()['x-api-key']).toBeUndefined();
  });

  it("sends the relay's expected user-agent, without which its WAF returns 401", async () => {
    const captured = captureHeaders();
    await call(new AnthropicClient('k', 'glm-5.3', 'https://agentrouter.org', 'bearer'));
    expect(captured.headers()['user-agent']).toMatch(/^claude-cli\//);
  });

  it('calls an HTML challenge page what it is, rather than a JSON syntax error', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('<!doctype html><html><body>Just a moment...</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const client = new AnthropicClient('k', 'glm-5.3', 'https://agentrouter.org', 'bearer');
    await expect(call(client)).rejects.toThrow(/instead of JSON.*bot challenge|challenge or a block page/);
  });

  it('names the relay in the label but not in the recorded id', () => {
    const direct = new AnthropicClient('k', 'claude-opus-4-8');
    const relayed = new AnthropicClient('k', 'claude-opus-4-8', 'https://agentrouter.org', 'bearer');
    expect(relayed.id).toBe(direct.id);
    expect(relayed.label).toBe('claude-opus-4-8 via agentrouter.org');
    expect(direct.label).toBe('Anthropic claude-opus-4-8');
  });

  it('does not call a relayed non-Anthropic model an Anthropic one', () => {
    const relayed = new AnthropicClient('k', 'glm-5.3', 'https://agentrouter.org', 'bearer');
    expect(relayed.label).toBe('glm-5.3 via agentrouter.org');
    expect(relayed.label).not.toMatch(/Anthropic/);
  });
});
