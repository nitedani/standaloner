export { onRenderHtml };

import { dangerouslySkipEscape } from 'vike/server';
import type { PageContextServer } from 'vike/types';

import 'package1';
import '@node-rs/argon2';
import 'sharp';

async function onRenderHtml(pageContext: PageContextServer) {
  return dangerouslySkipEscape(`<!DOCTYPE html>
    <html>
      <body>
        <div id="page-view">${pageContext.Page}</div>
      </body>
    </html>`);
}
