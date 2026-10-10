import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const frontendDir = process.cwd();
const builtDir = resolve(frontendDir, '../src/openjarvis/server/static');
const publishDir = resolve(frontendDir, 'dist');

await mkdir(publishDir, { recursive: true });
await rm(publishDir, { recursive: true, force: true });
await cp(builtDir, publishDir, { recursive: true });
console.log('Static site files copied to frontend/dist');
