// City layouts shared by the tests. Not a test file itself

import { createCity, Simulation } from '../../runner.ts';
import { build } from '../../actions.ts';
import type { SimulationLike } from '../../types.ts';

/* A coal plant, a road with zones on both sides and a power line, so that
 * growth, traffic, power and the budget run too. A few placements fail
 * where the land is not clear, which is fine for the tests. */
function createDevelopedCity(seed: number): SimulationLike {
  const city: SimulationLike = createCity({
    seed: seed,
    level: Simulation.LEVEL_EASY,
    disasters: true,
  });
  const roadY: number = 50;

  for (let x: number = 40; x <= 80; x++) {
    build(city, 'road', x, roadY);
  }

  build(city, 'coal', 40, roadY - 3);

  for (let x: number = 43; x <= 78; x += 3) {
    build(city, x % 9 === 0 ? 'commercial' : 'residential', x, roadY - 2);
    build(city, x % 2 === 0 ? 'industrial' : 'residential', x, roadY + 2);
  }

  for (let x: number = 42; x <= 80; x++) {
    build(city, 'wire', x, roadY - 4);
  }

  return city;
}

/* The developed city plus far more fire and police stations than its taxes
 * can pay for. It runs out of money in its second year. */
function createPoorCity(seed: number): SimulationLike {
  const city: SimulationLike = createDevelopedCity(seed);
  const stationRows: number[] = [40, 60];
  let stationCount: number = 0;

  for (let x: number = 56; x <= 100; x += 4) {
    for (const y of stationRows) {
      const toolName: string = stationCount % 2 === 0 ? 'fire' : 'police';

      if (build(city, toolName, x, y).success) {
        stationCount++;
      }
    }
  }

  return city;
}

export { createDevelopedCity, createPoorCity };
