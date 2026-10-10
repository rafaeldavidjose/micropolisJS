import type { Agent, GameAction } from '../types.ts';

// Does nothing. Used for the starting-scenario experiments
const passiveAgent: Agent = {
  name: 'passive',
  decide: (): GameAction[] => [],
};

export { passiveAgent };
