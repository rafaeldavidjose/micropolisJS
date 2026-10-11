/* A random generator for agents, apart from the game's. It is mulberry32,
 * the same as the seeded generator in src/random.ts, but with its own state,
 * so an agent's draws never move the game's sequence. */
interface Rng {
  // A number from 0 up to but not including 1
  next(): number;
  // A whole number from 0 to limit - 1
  int(limit: number): number;
}

function makeRng(seed: number): Rng {
  let state: number = seed >>> 0;

  const next: () => number = (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next: next,
    int: (limit: number): number => Math.floor(next() * limit),
  };
}

export type { Rng };
export { makeRng };
