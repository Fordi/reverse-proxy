import { createProxy } from './proxy.js';
import { resolve, relative } from 'node:path';

if (process.argv.length !== 3) {
  console.log(`Usage: ${process.argv[1]} [configuration.js]`);
  process.exit();
}
const configFile = `./${relative(process.cwd(), resolve(process.argv[2]))}`;
let config = await import(configFile);
config = config.default ?? config;

const server = await createProxy(config);