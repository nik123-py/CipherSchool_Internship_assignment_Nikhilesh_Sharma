import { Attempt } from '../src/domain/attempt/Attempt';
import { CriterionFeedback } from '../src/domain/evaluation/CriterionFeedback';
import { EvaluationRequest, Evaluator, EvaluatorVerdict } from '../src/domain/evaluation/Evaluator';
import { EvaluatorDescriptor } from '../src/domain/evaluation/Evaluation';
import { Rubric } from '../src/domain/evaluation/Rubric';
import { Score } from '../src/domain/evaluation/Score';
import { Clock, IdGenerator } from '../src/domain/shared/clock';
import { StructuredTextSubmission } from '../src/domain/submission/StructuredTextSubmission';
import { SubmissionFormat } from '../src/domain/submission/SubmissionContent';

export class FakeClock implements Clock {
  private current: Date;
  constructor(start = new Date('2026-01-01T10:00:00.000Z')) {
    this.current = start;
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}

/** A deliberately good submission: specific, cross-referenced, edge cases resolved. */
export const STRONG_SUBMISSION: Record<string, string> = {
  requirements: [
    '- Multi-floor lot; every spot has a size (motorcycle, compact, large) and a vehicle may only take a spot that fits it.',
    '- Entry issues a ticket holding the spot id, vehicle and entry time; exit prices the stay and frees the spot.',
    '- Pricing is hourly with a distinct first-hour rate, per vehicle type.',
    '- Operators can query free capacity per floor and per size.',
    '- Out of scope: multiple sites, online reservation and loyalty programmes.',
  ].join('\n'),
  assumptions: [
    '- Spot inventory is fixed at start-up and loaded from configuration.',
    '- A vehicle holds at most one active ticket, keyed by registration.',
    '- Money is an integer minor-unit Money value object, never a float.',
    '- The Clock is injected so pricing is deterministic in tests.',
  ].join('\n'),
  classes: [
    '- ParkingLot - the aggregate the gates talk to',
    '- ParkingFloor - owns the spots on one level',
    '- ParkingSpot - one space, holds its size and occupancy',
    '- Ticket - proof of entry, holds spot id and entry time',
    '- SpotAllocationStrategy - chooses a spot for a vehicle',
    '- FeeCalculator - turns a duration and vehicle type into Money',
    '- VehicleType (enum) - MOTORCYCLE, CAR, TRUCK',
    '- Money (value object) - integer minor units plus currency',
  ].join('\n'),
  responsibilities: [
    '- ParkingLot: accepts a vehicle at a gate and returns a Ticket or a NoSpotAvailable result',
    '- SpotAllocationStrategy: decides which free spot fits a vehicle',
    '- ParkingSpot: owns its own occupancy and rejects a second occupy() call',
    '- FeeCalculator: computes Money from entry time, exit time and vehicle type',
    '- Ticket: records the facts of one stay; it does not price itself',
    '- PaymentGateway: takes Money and reports success or failure',
  ].join('\n'),
  relationships: [
    '- ParkingLot composes 1..* ParkingFloor',
    '- ParkingFloor composes 1..* ParkingSpot',
    '- ParkingLot depends on the SpotAllocationStrategy interface, injected at construction',
    '- ParkingLot depends on FeeCalculator; neither knows about PaymentGateway',
    '- Ticket references exactly one ParkingSpot by id',
  ].join('\n'),
  interfaces: [
    '- SpotAllocationStrategy: nearest-first today, size-fit or EV-aware later, so the lot never changes',
    '- FeeCalculator: hourly today, because tariffs change per site',
    '- PaymentGateway: card today, wallet later; keeps the domain free of payment SDKs',
    '- Clock: injected so duration-based pricing is testable',
  ].join('\n'),
  patterns: [
    '- Strategy for SpotAllocationStrategy because the allocation rule varies per site',
    '- Value object for Money so rounding lives in one place',
    '- No Singleton for ParkingLot because it would make tests share state',
  ].join('\n'),
  flows:
    'Park: gate calls ParkingLot.park(vehicle). ParkingLot asks SpotAllocationStrategy.findSpot(vehicle) for a candidate, then calls spot.occupy(vehicle) which fails fast if the spot was taken, then TicketService.issue(spot, vehicle, clock.now()) returns a Ticket. ' +
    'Exit: gate calls ParkingLot.exit(ticket). FeeCalculator.calculate(ticket, clock.now()) returns Money, PaymentGateway.charge(money) is called, and only on success does spot.release() run so a failed payment never frees the spot.',
  edge_cases: [
    '- Lot full: park() returns a NoSpotAvailable result rather than throwing, so the gate can show a message.',
    '- Two vehicles race for the last spot: spot.occupy() is guarded per floor, and the loser gets NoSpotAvailable.',
    '- Lost ticket: exit falls back to a flat maximum-day rate recorded on the tariff.',
    '- Exit within the first minute: the first-hour rate still applies; there is no free window.',
    '- Payment fails: the spot stays occupied and the ticket stays open, so the money and the spot never disagree.',
  ].join('\n'),
  tradeoffs:
    'I kept allocation in memory and single-node instead of a shared index, because the requirement is one site and that keeps the invariant in one object. ' +
    'The cost is that a second gate process would double-book, so if we went multi-node I would put the free-spot index behind a repository interface backed by a shared store and let ParkingSpot claim optimistically. ' +
    'I also chose to price on exit rather than continuously, which is simpler but means a tariff change mid-stay applies to the whole stay.',
};

/**
 * A deliberately weak - but complete - design: long enough to pass the
 * structural gate, vague enough that every rubric criterion has something real
 * to complain about. This is what most first attempts actually look like.
 */
export const WEAK_SUBMISSION: Record<string, string> = {
  requirements: [
    '- Park cars in a parking lot and take money from them when they leave the building.',
    '- The system should handle vehicles and spots and tickets and payment for the whole building.',
    '- It should be fast and scalable and easy to use for everyone who parks there.',
  ].join('\n'),
  assumptions: [
    '- Everything is stored in memory and the lot always works correctly.',
    '- Nothing ever fails and the hardware is always available when we need it.',
    '- We can add more features later if the requirements change.',
  ].join('\n'),
  classes: [
    '- ParkingLot',
    '- Vehicle',
    '- Ticket',
    'These are the main classes of the system and they hold all the data that we need for parking.',
  ].join('\n'),
  responsibilities: [
    '- ParkingLot: finds the spot, parks the car, calculates the price, takes the payment, prints the ticket, sends a notification and writes the log',
    '- Vehicle: stores the number plate and the type and decides its own price when it leaves',
    '- Ticket: stores the data about the parking and gives it back when we need it later',
  ].join('\n'),
  relationships: [
    '- ParkingLot has vehicles inside it and manages all of them together',
    '- Vehicle has a ticket that belongs to it while it is parked in the lot',
    '- ParkingLot also has the tickets and the prices and the payment information',
  ].join('\n'),
  interfaces: [
    '- None really, ParkingLot does everything itself because that is simpler for now',
    '- We could add interfaces later when the system gets bigger and needs more features',
    '- The classes talk to each other directly which keeps the code short',
  ].join('\n'),
  patterns: ['- Singleton', '- Factory', '- Observer', '- Strategy', '- Builder'].join('\n'),
  flows:
    'The car comes into the parking lot and the parking lot parks it somewhere inside the building. ' +
    'Then the ticket is created for the car so that we know it is there and how long it has been parked. ' +
    'When it leaves the parking lot charges the vehicle for the time and then the car goes away happy.',
  edge_cases: [
    '- The lot could be full when a car arrives at the entrance gate',
    '- The ticket could be lost by the customer somewhere in the building',
    '- Something could go wrong with the payment when the customer tries to leave',
  ].join('\n'),
  tradeoffs:
    'This design is simple and easy to write so it is good enough for now and it can be improved later if it needs to be. ' +
    'Keeping everything in one class means there are fewer files to read and the code is short and quick to understand.',
};

export function strongContent(): StructuredTextSubmission {
  return StructuredTextSubmission.create(STRONG_SUBMISSION);
}

export function weakContent(): StructuredTextSubmission {
  return StructuredTextSubmission.create(WEAK_SUBMISSION);
}

export function draftAttempt(overrides: Partial<{ id: string; attemptNumber: number }> = {}): Attempt {
  return Attempt.start({
    id: overrides.id ?? 'att_1',
    problemId: 'parking-lot',
    learnerId: 'learner-1',
    attemptNumber: overrides.attemptNumber ?? 1,
    draft: StructuredTextSubmission.empty(),
    now: new Date('2026-01-01T10:00:00.000Z'),
  });
}

/** Evaluator that always succeeds, with fixed scores. */
export class StubEvaluator implements Evaluator {
  readonly descriptor: EvaluatorDescriptor = { id: 'stub:v1', kind: 'heuristic', label: 'Stub evaluator' };
  calls = 0;

  constructor(private readonly score = 7) {}

  supports(_format: SubmissionFormat): boolean {
    return true;
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluatorVerdict> {
    this.calls += 1;
    return {
      criteria: request.rubric.criteria.map(
        (c) =>
          new CriterionFeedback({
            criterionKey: c.key,
            score: Score.of(this.score),
            evidence: 'ParkingLot composes 1..* ParkingFloor',
            evidenceSection: 'relationships',
            concern: 'Stub concern.',
            suggestion: 'Stub suggestion.',
            confidence: 'medium',
            grounded: true,
          }),
      ),
      summary: 'Stub summary.',
      nextFocus: 'Stub focus.',
    };
  }
}

/** Evaluator that always fails, used to prove the failure path. */
export class ExplodingEvaluator implements Evaluator {
  readonly descriptor: EvaluatorDescriptor = { id: 'exploding:v1', kind: 'llm', label: 'Exploding evaluator' };
  calls = 0;

  constructor(private readonly message = 'model unavailable') {}

  supports(): boolean {
    return true;
  }

  async evaluate(): Promise<EvaluatorVerdict> {
    this.calls += 1;
    throw new Error(this.message);
  }
}

/** Evaluator that never resolves, used to prove the timeout path. */
export class HangingEvaluator implements Evaluator {
  readonly descriptor: EvaluatorDescriptor = { id: 'hanging:v1', kind: 'llm', label: 'Hanging evaluator' };
  supports(): boolean {
    return true;
  }
  evaluate(): Promise<EvaluatorVerdict> {
    return new Promise(() => {});
  }
}

export const RUBRIC = Rubric.default();
