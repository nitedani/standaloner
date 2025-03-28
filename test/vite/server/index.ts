import express from "express";
import { apply } from "vike-server/express";
import { serve } from "vike-server/express/serve";
import { init } from "../database/todoItems.js";
import path from "path"
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const file = path.join(__dirname, './file.txt');
console.log(file);
async function startServer() {
  await init();
  const app = express();
  apply(app);
  const port = process.env.PORT || 3000;
  return serve(app, { port: +port });
}

startServer();

console.log(__dirname);
