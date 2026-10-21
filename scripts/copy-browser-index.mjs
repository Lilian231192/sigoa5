import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const browserOutput = join('dist', 'sigoa', 'browser');
const source = join(browserOutput, 'index.csr.html');
const destination = join(browserOutput, 'index.html');

await copyFile(source, destination);
console.log(`Se creó ${destination} a partir de index.csr.html`);
