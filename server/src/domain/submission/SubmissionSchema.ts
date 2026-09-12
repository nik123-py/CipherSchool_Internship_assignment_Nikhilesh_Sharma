/**
 * The structured-text submission schema.
 *
 * It is data, not code: the API serves it, the web form renders itself from it,
 * deterministic rules validate against it, and the LLM prompt is built from it.
 * Adding or re-wording a section is a one-line change in exactly one place.
 */
export interface SectionSpec {
  readonly key: string;
  readonly title: string;
  readonly kind: 'prose' | 'list';
  readonly required: boolean;
  /** Deterministic floor for a submission to be worth evaluating. */
  readonly minWords: number;
  readonly helper: string;
  readonly placeholder: string;
  /** Rubric criteria this section is primary evidence for. */
  readonly feeds: string[];
}

export const STRUCTURED_TEXT_SECTIONS: readonly SectionSpec[] = [
  {
    key: 'requirements',
    title: 'Requirements you are designing for',
    kind: 'list',
    required: true,
    minWords: 25,
    helper:
      'Restate the problem in your own words. Which requirements are in scope, and which are explicitly out of scope?',
    placeholder:
      '- Support multiple vehicle types with different spot sizes\n- Issue a ticket on entry, compute a fee on exit\n- Out of scope: multi-site parking, online reservation',
    feeds: ['requirement_understanding'],
  },
  {
    key: 'assumptions',
    title: 'Assumptions',
    kind: 'list',
    required: true,
    minWords: 15,
    helper:
      'Anything the statement leaves open that you decided for yourself. Interviewers read this before anything else.',
    placeholder:
      '- Single physical site, capacity known at start-up\n- Payment settles in one attempt; no partial payments\n- Clock is server-side, so no timezone handling is needed',
    feeds: ['requirement_understanding', 'edge_cases_testability'],
  },
  {
    key: 'classes',
    title: 'Main classes and enums',
    kind: 'list',
    required: true,
    minWords: 20,
    helper:
      'One per line. Name the type and, in a few words, say what it *is*. Include enums and value objects.',
    placeholder:
      '- ParkingLot - the aggregate a caller talks to\n- ParkingFloor - owns the spots on one level\n- ParkingSpot - a single space with a size\n- Ticket - proof of entry, holds the entry time\n- VehicleType (enum) - MOTORCYCLE, CAR, TRUCK',
    feeds: ['class_responsibilities', 'abstraction_patterns'],
  },
  {
    key: 'responsibilities',
    title: 'Responsibilities',
    kind: 'list',
    required: true,
    minWords: 40,
    helper:
      'For each class: what does it own and decide? If a sentence needs the word "and" three times, that class is probably doing too much.',
    placeholder:
      '- ParkingLot: accepts a vehicle, delegates spot selection, issues tickets\n- SpotAllocationStrategy: decides which free spot fits a vehicle\n- FeeCalculator: turns a duration plus vehicle type into an amount',
    feeds: ['class_responsibilities', 'coupling_cohesion'],
  },
  {
    key: 'relationships',
    title: 'Relationships',
    kind: 'list',
    required: true,
    minWords: 20,
    helper:
      'How the classes are wired: composition, aggregation, inheritance, "uses". Mention cardinality where it matters.',
    placeholder:
      '- ParkingLot composes 1..* ParkingFloor\n- ParkingFloor composes 1..* ParkingSpot\n- ParkingLot depends on SpotAllocationStrategy (injected)\n- Ticket references exactly one ParkingSpot',
    feeds: ['coupling_cohesion', 'class_responsibilities'],
  },
  {
    key: 'interfaces',
    title: 'Interfaces and abstractions',
    kind: 'list',
    required: true,
    minWords: 20,
    helper:
      'Which seams are abstract, and why? Name the variation each abstraction is protecting against.',
    placeholder:
      '- SpotAllocationStrategy: nearest-first today, size-fit later\n- PaymentGateway: card today, wallet later\n- Clock: injected so pricing stays testable',
    feeds: ['encapsulation_interfaces', 'abstraction_patterns', 'extensibility'],
  },
  {
    key: 'patterns',
    title: 'Design patterns used (and why)',
    kind: 'list',
    required: false,
    minWords: 0,
    helper:
      'Optional. Only list a pattern if you can say what would break without it. "None needed" is a valid and respected answer.',
    placeholder:
      '- Strategy for spot allocation: the rule changes per site\n- Factory for Vehicle: keeps input parsing out of the domain\n- No Singleton: it would make the lot untestable',
    feeds: ['abstraction_patterns'],
  },
  {
    key: 'flows',
    title: 'Important flows',
    kind: 'prose',
    required: true,
    minWords: 40,
    helper:
      'Walk one or two core behaviours through your objects, step by step. Who calls whom, and what state changes?',
    placeholder:
      'Park a vehicle: ParkingLot.park(vehicle) asks SpotAllocationStrategy.findSpot(...) for a free spot, calls spot.occupy(vehicle), then TicketService issues a Ticket holding the entry time and the spot id, which is returned to the caller.',
    feeds: ['class_responsibilities', 'quality_of_explanation'],
  },
  {
    key: 'edge_cases',
    title: 'Edge cases and how you handle them',
    kind: 'list',
    required: true,
    minWords: 25,
    helper:
      'Concurrency, empty/full states, invalid input, retries, clock issues. Say what the system *does*, not just that the case exists.',
    placeholder:
      '- Lot full: park() returns a NoSpotAvailable result instead of throwing\n- Two cars race for the last spot: the spot is claimed under a per-floor lock\n- Lost ticket: exit falls back to a flat maximum-day rate',
    feeds: ['edge_cases_testability'],
  },
  {
    key: 'tradeoffs',
    title: 'Trade-offs and what you would change at scale',
    kind: 'prose',
    required: true,
    minWords: 30,
    helper:
      'What did you deliberately not do, and what would you reach for if the requirements changed?',
    placeholder:
      'I kept allocation in memory and single-node: it keeps the model simple and is correct for one site. For multiple sites I would put the free-spot index behind a repository interface so it can be backed by a shared store.',
    feeds: ['quality_of_explanation', 'extensibility'],
  },
] as const;

export function sectionSpec(key: string): SectionSpec | undefined {
  return STRUCTURED_TEXT_SECTIONS.find((s) => s.key === key);
}
