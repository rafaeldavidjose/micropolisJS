/* Opens the replay viewer in the browser on a run log, e.g.
 * npm run replay -- run.json
 * Without a log it plays a game with the demo agent and shows that one.
 * The page and the log come from a small server on this computer only. */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runGame } from './game.ts';
import { createDemoAgent } from './agents/demo.ts';

const HERE: string = dirname(fileURLToPath(import.meta.url));
const VIEWER: string = join(HERE, 'viewer');

// Everything the server answers. Any other path is a 404
const FILES: Record<string, [string, string]> = {
  '/': [join(VIEWER, 'index.html'), 'text/html; charset=utf-8'],
  '/index.html': [join(VIEWER, 'index.html'), 'text/html; charset=utf-8'],
  '/style.css': [join(VIEWER, 'style.css'), 'text/css; charset=utf-8'],
  '/viewer.js': [join(VIEWER, 'viewer.js'), 'text/javascript; charset=utf-8'],
  '/replay.js': [join(VIEWER, 'replay.js'), 'text/javascript; charset=utf-8'],
  '/tiles.js': [join(VIEWER, 'tiles.js'), 'text/javascript; charset=utf-8'],
  '/help.js': [join(VIEWER, 'help.js'), 'text/javascript; charset=utf-8'],
  '/tiles.png': [join(HERE, '..', 'images', 'tiles.png'), 'image/png'],
  '/sprites.png': [join(HERE, '..', 'images', 'sprites.png'), 'image/png'],
};

const DEMO_SEED: number = 1;

interface ReplayArguments {
  values: { 'port': string; 'no-open': boolean };
  positionals: string[];
}

const { values, positionals }: ReplayArguments = parseArgs({
  allowPositionals: true,
  options: {
    'port': { type: 'string', default: '0' },
    'no-open': { type: 'boolean', default: false },
  },
});

/* explorer.exe opens a folder instead of a URL with a query string, so on
 * Windows rundll32 hands the URL to the default browser as it is. No shell
 * runs in between, so the & in the query is safe. */
function openBrowser(url: string): void {
  const [command, args]: [string, string[]] = process.platform === 'win32' ?
    ['rundll32', ['url.dll,FileProtocolHandler', url]] :
    [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];

  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

const logPath: string | undefined = positionals[0];
let demoLog: string | null = null;

if (logPath === undefined) {
  console.log(`No log given, playing a demo game on seed ${DEMO_SEED}.`);
  demoLog = JSON.stringify(await runGame(createDemoAgent(),
    { seed: DEMO_SEED }));
} else if (!existsSync(logPath)) {
  throw new Error('No such file: ' + logPath);
}

const logName: string = logPath === undefined ? 'demo game' :
  basename(logPath);

// The log is read again on every request, so a reload shows a new run
function answer(request: IncomingMessage, response: ServerResponse): void {
  const path: string = new URL(request.url ?? '/', 'http://localhost')
    .pathname;

  if (path === '/log.json') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(demoLog ?? readFileSync(logPath as string));
    return;
  }

  const file: [string, string] | undefined = FILES[path];

  if (file === undefined) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, { 'Content-Type': file[1] });
  response.end(readFileSync(file[0]));
}

const server: Server = createServer(answer);

server.listen(Number(values.port), '127.0.0.1', (): void => {
  const port: number = (server.address() as AddressInfo).port;
  const url: string = `http://127.0.0.1:${port}/?log=log.json&name=` +
    encodeURIComponent(logName);

  console.log(`Replay viewer at ${url}`);
  console.log('Press Ctrl+C to stop.');

  if (!values['no-open']) {
    openBrowser(url);
  }
});
