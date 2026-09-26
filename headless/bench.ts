// Times 20 in-game years, run with npm run bench:headless

import { createCity, stepMonths, Simulation } from './runner.ts';

const YEARS = 20;
const SEED = 20260926;

const sim = createCity({ seed: SEED, level: Simulation.LEVEL_HARD, disasters: true });

const start = process.hrtime.bigint();
stepMonths(sim, 12 * YEARS);
const end = process.hrtime.bigint();

const elapsedMs = Number(end - start) / 1e6;

console.log(`Advanced ${YEARS} in-game years in ${elapsedMs.toFixed(2)} ms (${(elapsedMs / YEARS).toFixed(3)} ms/year)`);
