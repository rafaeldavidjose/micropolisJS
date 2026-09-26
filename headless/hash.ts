/* headless/hash.ts
 *
 * Hashes a Simulation's save() output for reproducibility checks. save()
 * always writes its keys in the same order, so JSON.stringify is stable
 * across runs without any sorting.
 */

import { createHash } from 'node:crypto';
import type { SimulationLike } from './types.ts';

function hashCity(sim: SimulationLike): string {
  const data = {};
  sim.save(data);
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export { hashCity };
