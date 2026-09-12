export type AttemptStatus = 'DRAFT' | 'SUBMITTED' | 'EVALUATING' | 'COMPLETED' | 'FAILED';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type Band = 'weak' | 'developing' | 'solid' | 'strong';
export type Confidence = 'low' | 'medium' | 'high';

export interface SectionSpec {
  key: string;
  title: string;
  kind: 'prose' | 'list';
  required: boolean;
  minWords: number;
  helper: string;
  placeholder: string;
  feeds: string[];
}

export interface RubricCriterion {
  key: string;
  title: string;
  question: string;
  weight: number;
  whatGoodLooksLike: string[];
  evidenceSections: string[];
}

export interface AppConfig {
  evaluation: { kind: string; label: string; isDemo: boolean; reason: string };
  rubric: { version: string; criteria: RubricCriterion[] };
  submissionSchema: { format: string; sections: SectionSpec[] };
  supportedFormats: string[];
}

export interface ProblemStats {
  attempts: number;
  bestOverall: number | null;
  lastStatus: string | null;
}

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string;
  tagline: string;
  estimatedMinutes: number;
  requirementCount: number;
  focusAreas: string[];
  stats: ProblemStats;
}

export interface ProblemDetail extends ProblemSummary {
  statement: string;
  functionalRequirements: string[];
  constraints: string[];
  designFocus: Array<{ area: string; question: string }>;
  edgeCases: string[];
  extensibilityProbe: string;
}

export interface Attempt {
  id: string;
  problemId: string;
  attemptNumber: number;
  status: AttemptStatus;
  format: string;
  isEditable: boolean;
  canRetryEvaluation: boolean;
  content: { sections: Record<string, string> };
  submittedAt: string | null;
  evaluationId: string | null;
  carriedFocus: string | null;
  failure: { reason: string; at: string; retryable: boolean } | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StructuralCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  section?: string;
}

export interface StructuralReport {
  isSubmittable: boolean;
  passed: number;
  total: number;
  checks: StructuralCheck[];
}

export interface CriterionResult {
  key: string;
  title: string;
  question: string;
  weight: number;
  score: number;
  band: Band;
  evidence: string;
  evidenceSection: string | null;
  evidenceSectionTitle: string | null;
  concern: string;
  suggestion: string;
  confidence: Confidence;
  grounded: boolean;
}

export interface Evaluation {
  id: string;
  attemptId: string;
  overall: number;
  band: Band;
  rubricVersion: string;
  evaluator: { id: string; kind: string; label: string };
  summary: string;
  nextFocus: string;
  durationMs: number;
  createdAt: string;
  criteria: CriterionResult[];
  strengths: CriterionResult[];
  priorities: CriterionResult[];
  ungroundedCount: number;
  structuralChecks: StructuralCheck[];
}

export interface CriterionDelta {
  criterionKey: string;
  title: string;
  previous: number;
  current: number;
  delta: number;
}

export interface Comparison {
  previousAttemptNumber: number;
  previousOverall: number;
  currentOverall: number;
  delta: number;
  improved: CriterionDelta[];
  regressed: CriterionDelta[];
  focusFollowUp?: { focus: string; criterionKey?: string; delta?: number };
}

export interface HistoryEntry {
  attempt: Attempt;
  problem: { id: string; title: string; difficulty: string };
  evaluation: {
    id: string;
    overall: number;
    band: Band;
    summary: string;
    nextFocus: string;
    evaluator: { id: string; kind: string; label: string };
    strengths: Array<{ key: string; title: string; score: number }>;
    priorities: Array<{ key: string; title: string; score: number }>;
  } | null;
  comparison: Comparison | null;
}

export interface AttemptDetail extends HistoryEntry {
  evaluationDetail: Evaluation | null;
}
