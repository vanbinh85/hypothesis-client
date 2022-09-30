'use strict';
/* eslint-env node */

const fs = require('fs');
const path = require('path');

const express = require('express');
const log = require('fancy-log');
const mustacheExpress = require('mustache-express');
const Mustache = require('mustache');

const { createServer, useSsl } = require('./create-server');

const HTML_PATH = `${__dirname}/documents/html/`;
const PDF_PATH = `${__dirname}/documents/pdf/`;
const TEMPLATE_PATH = `${__dirname}/templates/`;

/**
 * @typedef Config
 * @prop {string} clientUrl - The URL of the client's boot script
 * @prop {object} clientConfig - Additional configuration for the Hypothesis client
 */

/**
 * Render client config and script embed
 *
 * @param {object} context
 */
function renderScript(context) {
  const scriptTemplate = `
    {{{hypothesisConfig}}}

    <script src="/scripts/util.js"></script>
    <script>
      (function(){
        let clientUrl = '{{{clientUrl}}}'.replace('{current_host}', document.location.hostname);
        loadClient(clientUrl);
      })();
    </script>
  `;
  return Mustache.render(scriptTemplate, context);
}

/**
 * Read tags in test pages specifying custom headers to serve the content with.
 *
 * These tags look like `<!-- Header: <Key>: <Value> -->`.
 *
 * @param {string} content
 * @return {[key: string, value: string][]}
 */
function readCustomHeaderTags(content) {
  return content
    .split('\n')
    .map(line => {
      const keyValue = line.match(/<!--\s*Header:\s*([A-Za-z-]+):(.*)-->/);
      if (!keyValue) {
        return null;
      }
      return [keyValue[1], keyValue[2]];
    })
    .filter(kv => kv !== null);
}

/**
 * Build context for rendering templates in the defined views directory.
 *
 * @param {Config} config
 */
function templateContext(config) {
  // Just the config by itself, in contrast with `hypothesisScript`, which
  // combines this config with a <script> that adds the embed script
  const configTemplate = fs.readFileSync(
    `${TEMPLATE_PATH}client-config.js.mustache`,
    'utf-8'
  );
  const hypothesisConfig = Mustache.render(configTemplate, {
    exampleConfig: config.clientConfig
      ? JSON.stringify(config.clientConfig)
      : null,
  });

  return {
    hypothesisConfig,
    hypothesisScript: renderScript({
      hypothesisConfig,
      clientUrl: config.clientUrl,
    }),
  };
}

/**
 * An HTTP server which serves test documents with the development client embedded.
 *
 * @param {number} port - The port that the test server should listen on.
 * @param {Config} config - Config for the server
 */
function serveSidebarApp(port, config) {
  const app = express();

  app.engine('mustache', mustacheExpress());

  // Disable template caching.
  // See https://github.com/bryanburgers/node-mustache-express/issues/13.
  app.disable('view cache');

  app.set('view engine', 'mustache');
  app.set('views', [HTML_PATH, path.join(__dirname, '/templates')]);

  app.use(express.static(path.join(__dirname, 'static')));

  // Serve static PDF files out of the PDF directory, but serve under
  // `/pdf-source/` — these are needed by PDF JS viewer
  app.use('/pdf-source', express.static(PDF_PATH));

  // Enable CORS for assets so that cross-origin font loading works.
  app.use((req, res, next) => {
    res.append('Access-Control-Allow-Origin', '*');
    res.append('Access-Control-Allow-Methods', 'GET');
    next();
  });

  // Landing page
  app.get('/', (req, res) => {
    res.render('sidebar', templateContext(config));
  });

  app.get('/app.html', (req, res) => {
    res.render('sidebar', templateContext(config));
  });

  // Nothing else matches: this is a 404
  app.use((req, res) => {
    res.render('404', templateContext(config));
  });

  createServer(app).listen(port, () => {
    const scheme = useSsl ? 'https' : 'http';
    log(`Sidebar web server started at ${scheme}://localhost:${port}/`);
  });
}

module.exports = serveSidebarApp;
