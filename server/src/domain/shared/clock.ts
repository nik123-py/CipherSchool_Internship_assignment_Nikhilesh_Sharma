/** Injected so tests can freeze time and assert on ordering. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Injected so tests get stable, readable ids. */
export interface IdGenerator {
  next(prefix: string): string;
}

export const uuidIdGenerator: IdGenerator = {
  next: (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
};
