export { onRenderHtml };

import { dangerouslySkipEscape } from 'vike/server';
import type { PageContextServer } from 'vike/types';

import 'package1';
import argon2 from '@node-rs/argon2';
import sharp from "sharp"

sharp({})

console.log(argon2.hashSync('password'));

async function onRenderHtml(pageContext: PageContextServer) {
  return dangerouslySkipEscape(`<!DOCTYPE html>
    <html>
      <body>
        <div id="page-view">${pageContext.Page}</div>
      </body>
    </html>`);
}
