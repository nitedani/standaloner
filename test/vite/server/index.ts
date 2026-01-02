import express from 'express';
import { apply } from 'vike-server/express';
import { serve } from 'vike-server/express/serve';
import { init } from '../database/todoItems.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { three } from './other.node';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
// const file = fs.statSync(path.join(__dirname,'./file.txt'));
// console.log(file);
const file2 = path.join(__dirname, './nested/file.txt');
console.log(fs.statSync(file2));

// require('./something.node').logSomething()
const file = fs.statSync(fileURLToPath(new URL('./file.txt', import.meta.url)));
console.log(file);

async function startServer() {
  await init();
  const app = express();
  apply(app);
  const port = process.env.PORT || 3000;
  return serve(app, { port: +port });
}

startServer();

console.log('__dirname is:', __dirname);
console.log(three);
