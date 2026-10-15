/* Plays one game from the command line and writes the run log, e.g.
 * npm run play:headless -- --agent random --seed 3 --level hard
 *   --disasters on --turns 80 --out run.json
 * A bare file name for --out goes into runs/, which git ignores. */

import { mkdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_OPTIONS, allBudgetWindows, runGame, writeRunLog }
  from './game.ts';
import { Simulation } from './runner.ts';
import { createDemoAgent } from './agents/demo.ts';
import { createGreedyAgent } from './agents/greedy.ts';
import { passiveAgent } from './agents/passive.ts';
import { createRandomAgent } from './agents/random.ts';
import { createRulesAgent } from './agents/rules.ts';
import type { Agent, RunLog, TurnLog } from './types.ts';

const RUNS: string = join(dirname(fileURLToPath(import.meta.url)), '..',
  'runs');

const LEVELS: Record<string, number> = {
  easy: Simulation.LEVEL_EASY,
  medium: Simulation.LEVEL_MED,
  hard: Simulation.LEVEL_HARD,
};

interface PlayArguments {
  values: {
    'agent': string;
    'seed': string;
    'agent-seed'?: string;
    'level': string;
    'disasters': string;
    'turns': string;
    'months': string;
    'max-actions': string;
    'out': string;
  };
}

const { values }: PlayArguments = parseArgs({
  options: {
    'agent': { type: 'string', default: 'random' },
    'seed': { type: 'string', default: '1' },
    'agent-seed': { type: 'string' },
    'level': { type: 'string', default: 'easy' },
    'disasters': { type: 'string', default: 'off' },
    'turns': { type: 'string', default: String(DEFAULT_OPTIONS.turns) },
    'months': {
      type: 'string', default: String(DEFAULT_OPTIONS.monthsPerTurn),
    },
    'max-actions': {
      type: 'string', default: String(DEFAULT_OPTIONS.maxActionsPerTurn),
    },
    'out': { type: 'string', default: 'run.json' },
  },
});

function wholeNumber(name: string, text: string): number {
  const value: number = Number(text);

  if (!Number.isInteger(value)) {
    throw new Error('--' + name + ' must be a whole number, got ' + text);
  }

  return value;
}

function makeAgent(name: string, seed: number): Agent {
  if (name === 'random') {
    return createRandomAgent({ seed: seed });
  }

  if (name === 'passive') {
    return passiveAgent;
  }

  if (name === 'demo') {
    return createDemoAgent();
  }

  if (name === 'greedy') {
    return createGreedyAgent();
  }

  if (name === 'rules') {
    return createRulesAgent();
  }

  throw new Error('Unknown agent ' + name +
    ', use random, rules, greedy, passive or demo');
}

if (!(values.level in LEVELS)) {
  throw new Error('--level must be easy, medium or hard');
}

const seed: number = wholeNumber('seed', values.seed);
const agentSeed: number = values['agent-seed'] === undefined ? seed :
  wholeNumber('agent-seed', values['agent-seed']);

const log: RunLog = await runGame(
  makeAgent(values.agent, agentSeed), {
    seed: seed,
    level: LEVELS[values.level],
    disasters: values.disasters === 'on',
    turns: wholeNumber('turns', values.turns),
    monthsPerTurn: wholeNumber('months', values.months),
    maxActionsPerTurn: wholeNumber('max-actions', values['max-actions']),
  });

const out: string = values.out;
const path: string = basename(out) === out ? join(RUNS, out) : out;

mkdirSync(dirname(path), { recursive: true });
writeRunLog(path, log);

const windowYears: Set<number> = new Set(allBudgetWindows(log).map(
  (window: { date: { year: number } }): number => window.date.year));
const applied: number = log.turns.reduce(
  (sum: number, turn: TurnLog): number => sum + turn.actions.length, 0);

console.log(`${log.agent.name} on seed ${seed}: ` +
  `${log.final.date.year}-${log.final.date.month + 1}, ` +
  `population ${log.final.state.population}, ` +
  `funds ${log.final.state.funds}, ` +
  `${applied} actions, budget windows in ${windowYears.size} years. ` +
  `Log in ${relative(process.cwd(), path)}`);
