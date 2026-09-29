import { createCity, stepMonths, Simulation } from './runner.ts';
import type { SimulationLike } from './types.ts';

const YEARS: number = 20;
const SEED: number = 20260926;

const city: SimulationLike = createCity({
  seed: SEED,
  level: Simulation.LEVEL_HARD,
  disasters: true,
});

const startTime: bigint = process.hrtime.bigint();
stepMonths(city, 12 * YEARS);
const endTime: bigint = process.hrtime.bigint();

const elapsedMs: number = Number(endTime - startTime) / 1e6;
const msPerYear: number = elapsedMs / YEARS;

console.log(`Advanced ${YEARS} in-game years in ${elapsedMs.toFixed(2)} ms ` +
  `(${msPerYear.toFixed(3)} ms/year)`);
