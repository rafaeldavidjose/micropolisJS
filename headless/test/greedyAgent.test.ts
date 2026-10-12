// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGame } from '../game.ts';
import { ROUTE_TOOLS } from '../routes.ts';
import { createGreedyAgent } from '../agents/greedy.ts';
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

const OPTIONS: Partial<GameOptions> & { seed: number } = {
  seed: 1,
  turns: 24,
};

function allApplied(log: RunLog): AppliedAction[] {
  return log.turns.flatMap((turn: TurnLog): AppliedAction[] => turn.actions);
}

test('greedy agent: the same seed gives the same run', async () => {
  const first: RunLog = await runGame(createGreedyAgent(), OPTIONS);
  const second: RunLog = await runGame(createGreedyAgent(), OPTIONS);

  assert.deepEqual(first, second);
  assert.equal(first.final.hash, second.final.hash);
});

test('greedy agent: it builds a plant first, then a town', async () => {
  const log: RunLog = await runGame(createGreedyAgent(), OPTIONS);
  const first: GameAction = log.turns[0].actions[0].action as GameAction;

  assert.deepEqual(first, { ...first, type: 'build', tool: 'coal' });
  assert.ok(log.final.state.population > 1000);
});

/* The agent only gives the two ends of a route. The tiles in the log come
 * from planRoute when the action is applied. */
test('greedy agent: every route it plays comes from planRoute', async () => {
  const log: RunLog = await runGame(createGreedyAgent(), OPTIONS);
  const routes: AppliedAction[] = allApplied(log).filter(
    (applied: AppliedAction): boolean =>
      (applied.action as GameAction).type === 'route');

  assert.ok(routes.length > 0);

  for (const applied of routes) {
    assert.deepEqual(Object.keys(applied.action as object).sort(),
      ['from', 'to', 'tool', 'type']);
    assert.ok(applied.result.success);
    assert.ok(applied.tiles !== undefined && applied.tiles.length > 0);
  }

  for (const applied of allApplied(log)) {
    const action: GameAction = applied.action as GameAction;
    assert.ok(!(action.type === 'build' && ROUTE_TOOLS.includes(action.tool)));
  }
});

test('greedy agent: it never touches the taxes or the budget', async () => {
  const log: RunLog = await runGame(createGreedyAgent(),
    { ...OPTIONS, turns: 40 });
  const types: Set<string> = new Set(allApplied(log).map(
    (applied: AppliedAction): string => (applied.action as GameAction).type));

  assert.ok(!types.has('setTaxRate'));
  assert.ok(!types.has('setBudgetPercentages'));
  assert.ok(!types.has('setAutoBudget'));
});

/* The view's quote is wrapped to remember every answer. Each action the
 * agent returns must have been quoted that turn with success, and the
 * turn must be able to pay for all of them. */
test('greedy agent: it only plays actions whose quote succeeded',
  async () => {
  const greedy: Agent = createGreedyAgent();
  let checked: number = 0;
  const watched: Agent = {
    name: 'watched',
    decide: async (view: CityView): Promise<GameAction[]> => {
      const quotes: Map<string, ActionResult> = new Map();
      const actions: GameAction[] = await greedy.decide({
        ...view,
        quote: (action: GameAction): ActionResult => {
          const result: ActionResult = view.quote(action);
          quotes.set(JSON.stringify(action), result);
          return result;
        },
      });
      let spent: number = 0;

      for (const action of actions) {
        const quote: ActionResult | undefined =
          quotes.get(JSON.stringify(action));

        assert.ok(quote !== undefined && quote.success,
          'turn ' + view.turn + ': ' + JSON.stringify(action));
        spent += quote.cost;
        checked++;
      }

      assert.ok(spent <= view.state.funds);
      return actions;
    },
  };

  const log: RunLog = await runGame(watched, OPTIONS);

  assert.ok(checked > 20);
  assert.ok(allApplied(log).every(
    (applied: AppliedAction): boolean => applied.result.success));
});

/* With a new road only 6 tiles straight ahead, the agent stopped for good
 * on easy seed 4 after turn 19 and on seed 6 after turn 159, with money,
 * demand and free land left. Now it builds again after those turns, and in
 * every turn with a positive demand it either acts or waits for money. */
test('greedy agent: it keeps growing where it used to stop', async () => {
  const cases: { seed: number; stoppedAfter: number; turns: number }[] = [
    { seed: 4, stoppedAfter: 19, turns: 40 },
    { seed: 6, stoppedAfter: 159, turns: 175 },
  ];

  for (const { seed, stoppedAfter, turns } of cases) {
    const log: RunLog = await runGame(createGreedyAgent(),
      { seed: seed, turns: turns });
    const later: TurnLog[] = log.turns.filter(
      (turn: TurnLog): boolean => turn.turn > stoppedAfter);
    const built: TurnLog[] = later.filter((turn: TurnLog): boolean =>
      turn.actions.some((applied: AppliedAction): boolean =>
        applied.result.success));
    const stuck: TurnLog[] = later.filter((turn: TurnLog): boolean =>
      turn.actions.length === 0 && turn.agent?.waitingForMoney === false &&
      Math.max(turn.state.rci.residential, turn.state.rci.commercial,
        turn.state.rci.industrial) > 0);

    assert.ok(built.length > 0, 'seed ' + seed);
    assert.deepEqual(stuck.map((turn: TurnLog): number => turn.turn), [],
      'seed ' + seed);
  }
});
