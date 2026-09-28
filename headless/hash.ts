/* headless/hash.ts
 *
 * Hashes a Simulation's save() output for reproducibility checks. save()
 * always writes its keys in the same order, so JSON.stringify is stable
 * across runs without any sorting.
 */

import { createHash } from 'node:crypto';
import { saveCity } from './runner.ts';
import type { SimulationLike } from './types.ts';

function hashCity(sim: SimulationLike): string {
  return createHash('sha256').update(JSON.stringify(saveCity(sim))).digest('hex');
}

export { hashCity };
