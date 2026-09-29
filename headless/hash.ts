import { createHash } from 'node:crypto';
import { saveCity } from './runner.ts';
import type { SimulationLike } from './types.ts';

// save() writes its keys in a fixed order, so no sorting is needed
function hashCity(city: SimulationLike): string {
  const json: string = JSON.stringify(saveCity(city));
  return createHash('sha256').update(json).digest('hex');
}

export { hashCity };
