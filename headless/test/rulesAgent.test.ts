// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGame } from '../game.ts';
import { ROUTE_TOOLS } from '../routes.ts';
import { createRulesAgent } from '../agents/rules.ts';
import type {
  ActionResult,
  Agent,
  AppliedAction,
  CityView,
  GameAction,
  GameOptions,
  RunLog,
  TurnLog,
} from '../types.ts';

// A tuning seed, so the reporting seeds 1 to 10 stay untouched
const OPTIONS: Partial<GameOptions> & { seed: number } = {
  seed: 1001,
  turns: 40,
};

// The towns below are built on clear land of this map, east of its river
const TOWN_SEED: number = 20260926;
const AGENT_ACTIONS: number = 5;

interface Script {
  setup: GameAction[];
  later?: Record<number, GameAction[]>;
  funds?: number;
}

function allApplied(log: RunLog): AppliedAction[] {
  return log.turns.flatMap((turn: TurnLog): AppliedAction[] => turn.actions);
}

function rulesOf(turn: TurnLog): string[] {
  return (turn.agent?.rules ?? []) as string[];
}

function roadRow(y: number, fromX: number, toX: number): GameAction[] {
  const actions: GameAction[] = [];

  for (let x: number = fromX; x <= toX; x++) {
    actions.push({ type: 'build', tool: 'road', x: x, y: y });
  }

  return actions;
}

/* Builds a town in the first turn, then lets the agent play with its own
 * action limit. Actions in later are played after the agent's in that
 * turn, so they cannot change the routes the agent planned. With funds
 * set, the agent sees that much money, so it cannot grow the town. */
function scripted(script: Script, agent: Agent): Agent {
  return {
    name: 'scripted',
    report: (): Record<string, unknown> => agent.report?.() ?? {},
    decide: async (view: CityView): Promise<GameAction[]> => {
      if (view.turn === 0) {
        return script.setup;
      }

      const state: CityView['state'] = script.funds === undefined ?
        view.state : { ...view.state, funds: script.funds };
      const actions: GameAction[] = await agent.decide(
        { ...view, maxActions: AGENT_ACTIONS, state: state });

      return [...actions, ...(script.later?.[view.turn] ?? [])];
    },
  };
}

function playTown(script: Script, turns: number): Promise<RunLog> {
  return runGame(scripted(script, createRulesAgent()),
    { seed: TOWN_SEED, turns: turns, maxActionsPerTurn: 400 });
}

// A coal plant and four commercial zones with power along a short road
function shopTown(): GameAction[] {
  return [
    ...roadRow(40, 60, 72),
    { type: 'build', tool: 'coal', x: 57, y: 38 },
    { type: 'build', tool: 'commercial', x: 61, y: 38 },
    { type: 'build', tool: 'commercial', x: 64, y: 38 },
    { type: 'build', tool: 'commercial', x: 67, y: 38 },
    { type: 'build', tool: 'commercial', x: 70, y: 38 },
  ];
}

/* Seven roads with six rows of homes and some industry between them, a
 * coal plant and a power line along their west end. One site in the
 * middle is left free. */
function gridTown(): GameAction[] {
  const actions: GameAction[] = [];

  for (let y: number = 30; y <= 54; y += 4) {
    actions.push(...roadRow(y, 60, 96));
  }

  actions.push({ type: 'build', tool: 'coal', x: 56, y: 42 });

  for (let y: number = 32; y <= 52; y += 4) {
    for (let x: number = 61; x <= 94; x += 3) {
      if (x !== 79 || y !== 44) {
        actions.push({ type: 'build',
          tool: x % 9 === 7 ? 'industrial' : 'residential', x: x, y: y });
      }
    }
  }

  actions.push({ type: 'route', tool: 'wire', from: { x: 59, y: 32 },
    to: { x: 59, y: 52 } });
  return actions;
}

test('rules agent: the same seed gives the same run',
  async (): Promise<void> => {
  const first: RunLog = await runGame(createRulesAgent(), OPTIONS);
  const second: RunLog = await runGame(createRulesAgent(), OPTIONS);

  assert.deepEqual(first, second);
  assert.equal(first.final.hash, second.final.hash);
  assert.ok(first.final.state.population > 1000);
});

/* The agent only gives the two ends of a route. The tiles in the log come
 * from planRoute when the action is applied. */
test('rules agent: every route it plays comes from planRoute',
  async (): Promise<void> => {
  const log: RunLog = await runGame(createRulesAgent(), OPTIONS);
  const routes: AppliedAction[] = allApplied(log).filter(
    (applied: AppliedAction): boolean =>
      (applied.action as GameAction).type === 'route');

  assert.ok(routes.length > 0);

  for (const applied of routes) {
    assert.deepEqual(Object.keys(applied.action as object).sort(),
      ['from', 'to', 'tool', 'type']);
    assert.ok(applied.tiles !== undefined && applied.tiles.length > 0);
  }

  for (const applied of allApplied(log)) {
    const action: GameAction = applied.action as GameAction;
    assert.ok(!(action.type === 'build' && ROUTE_TOOLS.includes(action.tool)));
  }
});

/* The view's quote is wrapped to remember every answer. Each action the
 * agent returns must have been quoted that turn with success, and what
 * the turn spends must leave the reserve, unless it spends nothing. */
test('rules agent: it only plays actions whose quote succeeded',
  async (): Promise<void> => {
  const rules: Agent = createRulesAgent();
  let checked: number = 0;
  const watched: Agent = {
    name: 'watched',
    decide: async (view: CityView): Promise<GameAction[]> => {
      const quotes: Map<string, ActionResult> = new Map();
      const actions: GameAction[] = await rules.decide({
        ...view,
        quote: (action: GameAction): ActionResult => {
          const result: ActionResult = view.quote(action);
          quotes.set(JSON.stringify(action), result);
          return result;
        },
      });
      const reserve: number = rules.report?.().reserve as number;
      let spent: number = 0;

      for (const action of actions) {
        const quote: ActionResult | undefined =
          quotes.get(JSON.stringify(action));

        assert.ok(quote !== undefined && quote.success,
          'turn ' + view.turn + ': ' + JSON.stringify(action));
        spent += quote.cost;
        checked++;
      }

      assert.ok(spent === 0 || spent <= view.state.funds - reserve,
        'turn ' + view.turn);
      return actions;
    },
  };

  const log: RunLog = await runGame(watched, OPTIONS);

  assert.ok(checked > 40);
  assert.ok(allApplied(log).filter((applied: AppliedAction): boolean =>
    !applied.result.success).length <= 1);
});

test('rules agent: it restores the funding and auto budget',
  async (): Promise<void> => {
  const log: RunLog = await playTown({
    setup: [
      ...shopTown(),
      { type: 'setBudgetPercentages', road: 50, fire: 50, police: 50 },
      { type: 'setAutoBudget', enabled: false },
    ],
  }, 3);

  assert.deepEqual(log.turns[1].state.funding,
    { road: 50, fire: 50, police: 50 });
  assert.ok(rulesOf(log.turns[1]).includes('funding'));
  assert.ok(rulesOf(log.turns[1]).includes('auto-budget'));
  assert.deepEqual(log.turns[2].state.funding,
    { road: 100, fire: 100, police: 100 });
  assert.equal(log.turns[2].state.autoBudget, true);
});

/* A road tile the agent has seen is bulldozed in turn 2. In turn 3 it is
 * bare land, and the agent lays a road there again. */
test('rules agent: it rebuilds a road tile that is gone',
  async (): Promise<void> => {
  const log: RunLog = await playTown({
    setup: shopTown(),
    later: { 2: [{ type: 'bulldoze', x: 66, y: 40 }] },
  }, 5);
  const repairs: AppliedAction[] = log.turns[3].actions.filter(
    (applied: AppliedAction, index: number): boolean =>
      rulesOf(log.turns[3])[index] === 'repair-road');

  assert.ok(log.turns[2].actions[log.turns[2].actions.length - 1].result
    .success);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].tiles, [[66, 40]]);
  assert.ok(repairs[0].result.success);
});

/* The grid town has over 200 developed blocks and no fire station, so a
 * fire station goes on the free site in the middle soon. As it grows,
 * crime passes 50 and a police station follows. Its industry stands next
 * to homes and is bulldozed while it is empty. */
test('rules agent: it builds fire and police stations and clears industry',
  async (): Promise<void> => {
  const log: RunLog = await playTown({ setup: gridTown() }, 10);
  const turns: TurnLog[] = log.turns.slice(1);
  const rulesPlayed: string[] = turns.flatMap(rulesOf);
  const fire: AppliedAction | undefined = allApplied(log).find(
    (applied: AppliedAction): boolean =>
      JSON.stringify(applied.action) === JSON.stringify(
        { type: 'build', tool: 'fire', x: 79, y: 44 }));
  const police: TurnLog | undefined = turns.find(
    (turn: TurnLog): boolean => rulesOf(turn).includes('police'));

  assert.ok(fire !== undefined && fire.result.success);
  assert.ok(police !== undefined);
  assert.ok(police.state.problems.crime > 50);
  assert.ok(turns.filter((turn: TurnLog): boolean =>
    turn.state.problems.crime > 50 && turn.turn < police.turn).length === 0);
  assert.ok(rulesPlayed.includes('demolish-polluter'));
});

/* With no residents, commercial demand stays negative and the shops stay
 * empty. The agent sees only $60, so it cannot grow the town either. The
 * zones have power from turn 1, and 75 months later, in turn 26, the
 * agent bulldozes one of them, not before. */
test('rules agent: it bulldozes a zone left empty for 75 months',
  async (): Promise<void> => {
  const log: RunLog = await playTown({ setup: shopTown(), funds: 60 }, 28);
  const demolitions: TurnLog[] = log.turns.filter((turn: TurnLog): boolean =>
    rulesOf(turn).includes('demolish-empty'));

  assert.ok(log.turns[1].state.rci.commercial < 0);
  assert.equal(demolitions.length, 1);
  assert.equal(demolitions[0].turn, 1 + Math.ceil(75 / 3));
  assert.equal((demolitions[0].actions[0].action as GameAction).type,
    'bulldoze');
  assert.ok(demolitions[0].actions[0].result.success);
});
