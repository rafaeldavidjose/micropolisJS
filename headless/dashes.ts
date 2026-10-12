import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

/* Finds the long dash, which the code style forbids anywhere in our files:
 * code, comments, strings, pages and docs. Run by npm run lint. */

const LONG_DASH: string = '\u2014';
const TEXT_EXTENSIONS: string[] = ['.css', '.html', '.js', '.json', '.md',
  '.ts'];
const ROOT: string = dirname(import.meta.dirname);
const ROOT_FILES: string[] = ['eslint.config.js'];

function filesIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(
    (entry: Dirent): string[] => entry.isDirectory() ?
      filesIn(join(folder, entry.name)) : [join(folder, entry.name)]);
}

function dashesIn(file: string): string[] {
  const lines: string[] = readFileSync(file, 'utf8').split('\n');
  const found: string[] = [];

  lines.forEach((line: string, index: number): void => {
    const column: number = line.indexOf(LONG_DASH);

    if (column >= 0) {
      found.push(relative(ROOT, file).replaceAll('\\', '/') + ':' +
        (index + 1) + ':' + (column + 1) + ' long dash');
    }
  });

  return found;
}

const files: string[] = filesIn(join(ROOT, 'headless'))
  .filter((file: string): boolean => TEXT_EXTENSIONS.includes(extname(file)))
  .concat(ROOT_FILES.map((file: string): string => join(ROOT, file)));
const found: string[] = files.flatMap(dashesIn);

for (const problem of found) {
  console.log(problem);
}

if (found.length > 0) {
  process.exitCode = 1;
}
