import {readdir} from 'node:fs/promises';
import path from 'node:path';
export async function filesUnder(directory, {exclude = []} = {}) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (exclude.includes(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(file, {exclude}));
    else if (entry.isFile()) result.push(file);
  }
  return result.sort();
}
