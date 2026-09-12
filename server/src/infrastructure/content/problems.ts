import { ProblemDefinition } from '../../domain/problem/Problem';

/**
 * The problem set, authored as data.
 *
 * Four problems, chosen so that each one pressures a *different* design muscle:
 * allocation policy, state machines, transactional behaviour, and concurrent
 * reservation. A larger catalogue would not have made the practice loop better.
 */
export const PROBLEM_DEFINITIONS: readonly ProblemDefinition[] = [
  {
    id: 'parking-lot',
    title: 'Parking Lot',
    difficulty: 'Starter',
    estimatedMinutes: 35,
    tagline: 'The classic. Allocation policy, pricing, and the discipline to keep them apart.',
    statement:
      'Design the software that runs a single multi-floor parking facility. Vehicles arrive at an entry gate, are given a spot and a ticket, and pay at an exit gate based on how long they stayed. The interesting part is not the data model - it is where the *decisions* live: which spot a vehicle gets, and what it costs.',
    functionalRequirements: [
      'The lot has multiple floors; each floor has spots of different sizes (motorcycle, compact, large).',
      'A vehicle of a given type can only occupy a spot that fits it, following a documented fit policy.',
      'On entry the system issues a ticket recording the spot, the vehicle and the entry time.',
      'On exit the system computes a fee from the parked duration and the vehicle type, and frees the spot.',
      'Pricing is hourly with a first-hour rate that differs from subsequent hours.',
      'An operator can query free capacity per floor and per spot size.',
      'Payment can be made by cash or card; the parking domain must not depend on which.',
    ],
    constraints: [
      'Single physical site, in-process, no distributed coordination.',
      'Spot inventory is fixed at start-up.',
      'A vehicle holds at most one active ticket at a time.',
      'Money must never be represented as a floating point number.',
    ],
    designFocus: [
      {
        area: 'Allocation policy',
        question:
          'Who decides which spot a vehicle gets, and how would you change that rule for a different site without touching the lot itself?',
      },
      {
        area: 'Pricing',
        question: 'Where does fee calculation live so that a new tariff does not require editing the parking flow?',
      },
      {
        area: 'Spot state',
        question: 'What guarantees that a spot cannot be handed to two vehicles, and which object owns that guarantee?',
      },
      {
        area: 'Payment boundary',
        question: 'What does the domain need to know about payment, and what should it refuse to know?',
      },
    ],
    edgeCases: [
      'The lot (or the only fitting size) is full.',
      'Two vehicles arrive at the same instant and both fit the last spot.',
      'A ticket is lost and the exit gate has no entry time.',
      'A vehicle exits within the first minute.',
      'Payment fails at the exit gate - does the spot stay occupied?',
    ],
    extensibilityProbe:
      'Next sprint we want electric-vehicle spots that charge per kWh in addition to time, and a monthly-pass holder who parks for free.',
  },
  {
    id: 'elevator',
    title: 'Elevator System',
    difficulty: 'Core',
    estimatedMinutes: 40,
    tagline: 'A state machine wearing a scheduling problem as a hat.',
    statement:
      'Design the control software for a bank of elevators in an office building. Passengers press a call button on a floor (up or down) and a destination button inside a car. The system decides which car serves which request and how each car moves. The design question is how you keep the car\'s own state machine separate from the policy that assigns requests to cars.',
    functionalRequirements: [
      'The building has N floors and M elevator cars, both configured at start-up.',
      'A hall call carries a floor and a direction; a car call carries a destination floor.',
      'Each car has a state (idle, moving up, moving down, doors opening, doors open, doors closing) with legal transitions.',
      'A dispatcher assigns each hall call to exactly one car using a documented policy.',
      'A car serves stops in a sensible order rather than strictly first-come-first-served.',
      'Doors stay open for a configured dwell time and reopen if an obstruction is detected.',
      'The system exposes each car\'s current floor, direction and door state for a display panel.',
    ],
    constraints: [
      'A car may only change direction when it has no remaining stops in the current direction.',
      'Movement is driven by a tick or event source, which must be injectable for tests.',
      'No real hardware: the motor and door subsystems sit behind interfaces.',
      'A single request must never be served by two cars.',
    ],
    designFocus: [
      {
        area: 'Car state machine',
        question: 'Which transitions are legal, and what object rejects the illegal ones?',
      },
      {
        area: 'Dispatch policy',
        question:
          'Where does "which car should take this call" live, so that a different building can use a different rule?',
      },
      {
        area: 'Stop ordering',
        question: 'Who owns the ordered set of stops for a car, and how is a new stop inserted into it?',
      },
      {
        area: 'Time',
        question: 'How does the system advance without a real clock, so behaviour can be tested deterministically?',
      },
    ],
    edgeCases: [
      'A call arrives for the floor a car is currently stopped at with its doors open.',
      'Every car is busy and moving away from the caller.',
      'A passenger presses the same destination twice.',
      'The obstruction sensor fires repeatedly and the doors never close.',
      'A car is taken out of service with passengers inside and pending stops.',
    ],
    extensibilityProbe:
      'Next sprint we want an express car that only serves floors 10-20, and a fire mode that recalls every car to the ground floor and ignores hall calls.',
  },
  {
    id: 'vending-machine',
    title: 'Vending Machine',
    difficulty: 'Starter',
    estimatedMinutes: 30,
    tagline: 'Small surface, unforgiving states. Money and inventory must agree at every step.',
    statement:
      'Design the software inside a vending machine. A customer inserts coins or notes, selects a product, and receives the product plus change - or a refund. The machine must never dispense a product it cannot charge for, never take money it cannot fulfil, and must be able to explain what state it is in at any moment.',
    functionalRequirements: [
      'Products are held in addressable slots, each with a price and a remaining quantity.',
      'The customer inserts money incrementally and can cancel at any point before dispensing.',
      'A selection is only accepted if the slot has stock and the inserted amount covers the price.',
      'The machine dispenses the product and returns exact change from the coins it actually holds.',
      'If exact change cannot be made, the machine refuses the sale before taking the money.',
      'An operator can restock a slot and collect the cash box.',
      'The machine reports its current state and the amount currently inserted.',
    ],
    constraints: [
      'All amounts are integer minor units (cents); no floating point money.',
      'Coin inventory is finite and must stay consistent with what was dispensed.',
      'One transaction at a time; the machine has a single physical customer.',
      'A power cycle must not leave money credited to nobody.',
    ],
    designFocus: [
      {
        area: 'Transaction state',
        question: 'What are the machine\'s states, and which object enforces that dispensing cannot happen from the wrong one?',
      },
      {
        area: 'Change making',
        question: 'Where does the change algorithm live, and how is it kept honest about the coins actually in the machine?',
      },
      {
        area: 'Inventory',
        question: 'Who owns stock levels, and at what moment is stock committed to a sale?',
      },
      {
        area: 'Failure',
        question: 'When a step fails halfway, what puts money and inventory back in agreement?',
      },
    ],
    edgeCases: [
      'The selected slot is empty.',
      'The customer inserts more than the price and the machine cannot make exact change.',
      'The customer cancels after inserting money but before selecting.',
      'The dispensing mechanism jams after the money was accepted.',
      'Two coins are inserted while the machine is already dispensing.',
    ],
    extensibilityProbe:
      'Next sprint we want card payments (authorise then capture) alongside coins, and a promotion where every fifth purchase from a slot is free.',
  },
  {
    id: 'movie-ticket-booking',
    title: 'Movie Ticket Booking',
    difficulty: 'Advanced',
    estimatedMinutes: 45,
    tagline: 'Seat inventory under contention: holds, expiry, and the honest handling of a race.',
    statement:
      'Design the booking core for a cinema chain. A customer picks a show, chooses seats, holds them while they pay, and ends up with a confirmed booking - or the seats go back on sale. Everything interesting here happens because two customers want seat H12 at the same moment.',
    functionalRequirements: [
      'A cinema has halls; a hall has a fixed seat layout with seat types (regular, premium).',
      'A show is a movie playing in a hall at a time, with a price per seat type.',
      'A customer can see which seats are available for a show.',
      'Selecting seats places a temporary hold that expires after a fixed window.',
      'Confirming payment turns a hold into a booking; the seats are then unavailable.',
      'An expired or cancelled hold returns the seats to the available pool.',
      'A booking can be cancelled up to a cut-off time before the show starts.',
    ],
    constraints: [
      'A seat can be held or booked by at most one customer for a given show - this is the core invariant.',
      'Payment is an external service behind an interface; it may be slow or fail.',
      'Hold expiry must not depend on a background job being alive to be correct.',
      'Single service instance is acceptable; say what would change if it were not.',
    ],
    designFocus: [
      {
        area: 'Seat inventory',
        question: 'Which object owns seat availability for a show, and what makes double-booking impossible rather than unlikely?',
      },
      {
        area: 'Hold lifecycle',
        question: 'What are the states of a seat for a show, and what drives the transition when a hold expires?',
      },
      {
        area: 'Payment boundary',
        question: 'What happens to the hold while payment is in flight, and what happens if payment succeeds after expiry?',
      },
      {
        area: 'Pricing',
        question: 'Where does the price of a booking come from, given seat type, show and possible discounts?',
      },
    ],
    edgeCases: [
      'Two customers select the same seat within milliseconds.',
      'A hold expires while the payment call is still in flight.',
      'Payment succeeds but the confirmation write fails.',
      'A customer tries to book zero seats, or more than the per-booking limit.',
      'A show is cancelled while holds and bookings exist against it.',
    ],
    extensibilityProbe:
      'Next sprint we want seat-group rules (no single empty seat left between bookings) and dynamic pricing that raises prices as a show fills up.',
  },
];
