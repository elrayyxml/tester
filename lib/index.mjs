import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cjs = require('./index.js');

export const Client = cjs.Client;
export const Utils = cjs.Utils;

export default { Client: cjs.Client, Utils: cjs.Utils };
