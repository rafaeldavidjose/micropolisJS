/* A random generator for agents, apart from the game's. It is mulberry32,
 * the same as the seeded generator in src/random.ts, but with its own state,
 * so an agent's draws never move the game's sequence. */
interface Rng {
  // A number from 0 up to but not including 1
  next(): number;
  // A whole number from 0 to n - 1
  int(n: number): number;
}

function makeRng(seed: number): Rng {
  let state: number = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let t: number = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next: next,
    int: (n: number): number => Math.floor(next() * n),
  };
}

export type { Rng };
export { makeRng };
