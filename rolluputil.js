const { pathToFileURL } = require('url');
const log = require('fancy-log');
const rollup = require('rollup');
const { createHash } = require('crypto');
const { readFile, mkdir, writeFile } = require('fs/promises');
const path = require('path');
const glob = require('glob');
const { basename, dirname, extname } = path;
const autoprefixer = require('autoprefixer');
const postcss = require('postcss');
const sass = require('sass');
const { mkdirSync, writeFileSync } = require('fs');
const { program } = require('commander');

//const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {import('rollup').RollupWarning} warning */
function logRollupWarning(warning) {
  log.info(`Rollup warning: ${warning} (${warning.url})`);
}
console.log(dirname('./'));
/** @param {string} path */
async function readConfig(filepath) {
  const { default: config } = await import(pathToFileURL(path.resolve(dirname('./'), filepath)));
  return Array.isArray(config) ? config : [config];
}

/**
 * Build a JavaScript bundle using a Rollup config.
 *
 * @param {string} rollupConfig - Path to Rollup config file
 */
async function buildJS(rollupConfig) {
  const configs = await readConfig(rollupConfig);

  await Promise.all(
    configs.map(async config => {
      const bundle = await rollup.rollup({
        ...config,
        onwarn: logRollupWarning,
      });
      await bundle.write(config.output);
    })
  );
}

/**
 * Build a JavaScript bundle using a Rollup config and auto-rebuild when any
 * source files change.
 *
 * @param {string} rollupConfig - Path to Rollup config file
 * @return {Promise<void>}
 */
async function watchJS(rollupConfig) {
  const configs = await readConfig(rollupConfig);

  const watcher = rollup.watch(
    configs.map(config => ({
      ...config,
      onwarn: logRollupWarning,
    }))
  );

  return new Promise(resolve => {
    watcher.on('event', event => {
      switch (event.code) {
        case 'START':
          log.info('JS build starting...');
          break;
        case 'BUNDLE_END':
          event.result.close();
          break;
        case 'ERROR':
          log.info('JS build error', event.error);
          break;
        case 'END':
          log.info('JS build completed.');
          resolve(); // Resolve once the initial build completes.
          break;
      }
    });
  });
}

/**
 * Generate a manifest that maps asset paths to cache-busted URLs.
 *
 * The generated manifest file is suitable for use with the h-assets Python
 * package (https://pypi.org/project/h-assets/) used by backend Hypothesis
 * projects for serving static assets. The manifest looks like:
 *
 * ```
 * {
 *   "scripts/app.bundle.js": "scripts/app.bundle.js?abc123",
 *   "styles/app.css": "styles/app.css?def456",
 *   ...
 * }
 * ```
 *
 * Returns the data that was written to the manifest.
 *
 * @param {object} options
 *   @param {string} [options.pattern] - Glob pattern that specifies which assets to include
 *   @param {string} [options.manifestPath] - File path to write the manifest to
 * @return {Promise<Record<string, string>>}
 */
 async function generateManifest({
    pattern = 'build/**/*.{css,js,map}',
    manifestPath = 'build/manifest.json',
  } = {}) {
    const manifestDir = path.dirname(manifestPath);
    const files = glob.sync(pattern);
  
    /** @type {Record<string, string>} */
    const manifest = {};
  
    await Promise.all(
      files.map(async file => {
        const fileContent = await readFile(file);
        const hash = await createHash('sha1');
        hash.update(fileContent);
  
        const hashSuffix = hash.digest('hex').slice(0, 6);
        const relativePath = path.relative(manifestDir, file);
        manifest[relativePath] = `${relativePath}?${hashSuffix}`;
      })
    );
  
    const manifestData = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
    await writeFile(manifestPath, manifestData);
  
    return manifest;
}
  
/**
 * @typedef {import('tailwindcss').Config} TailwindConfig
 */

/**
 * Build CSS bundles from SASS or CSS inputs.
 *
 * @param {string[]} inputs - An array of CSS or SCSS file paths specifying the
 *   entry points of style bundles. The output files will be written to
 *   `build/styles/[name].css` where `[name]` is the basename of the input file
 *   minus the file extension.
 * @param {object} options
 *   @param {TailwindConfig} [options.tailwindConfig]
 *   Optional tailwind config object
 * @return {Promise<void>} Promise for completion of the build.
 */
 async function buildCSS(inputs, { tailwindConfig } = {}) {
    const outDir = 'build/styles';
    const minify = process.env.NODE_ENV === 'production';
    await mkdir(outDir, { recursive: true });
  
    /** @type {import('postcss').PluginCreator<TailwindConfig>} */
    let tailwindcss;
    try {
      tailwindcss = (await import('tailwindcss')).default;
    } catch {
      // Ignored
    }
  
    await Promise.all(
      inputs.map(async input => {
        const output = `${outDir}/${basename(input, extname(input))}.css`;
        const sourcemapPath = output + '.map';
  
        const sassResult = sass.renderSync({
          file: input,
          includePaths: [dirname(input), 'node_modules'],
          outputStyle: minify ? 'compressed' : 'expanded',
          sourceMap: sourcemapPath,
        });
  
        const optionalPlugins = [];
        if (tailwindcss && tailwindConfig) {
          optionalPlugins.push(tailwindcss(tailwindConfig));
        }
  
        const cssProcessor = postcss([...optionalPlugins, autoprefixer()]);
  
        const postcssResult = await cssProcessor.process(sassResult.css, {
          from: input,
          to: output,
          map: {
            inline: false,
            prev: sassResult.map?.toString(),
          },
        });
  
        await writeFile(output, postcssResult.css);
        await writeFile(sourcemapPath, postcssResult.map.toString());
      })
    );
}
  
/**
 * Build a bundle of tests and run them using Karma.
 *
 * @param {object} options
 *   @param {string} options.bootstrapFile - Entry point for the test bundle that initializes the environment
 *   @param {string} options.rollupConfig - Rollup config that generates the test bundle using
 *     `${outputDir}/test-inputs.js` as an entry point
 *   @param {string} options.karmaConfig - Karma config file
 *   @param {string} options.outputDir - Directory in which to generate test bundle. Defaults to
 *     `build/scripts`
 *   @param {string} options.testsPattern - Minimatch pattern that specifies which test files to
 *   load
 * @return {Promise<void>} - Promise that resolves when test run completes
 */
 async function runTests({
    bootstrapFile,
    rollupConfig,
    outputDir = 'build/scripts',
    karmaConfig,
    testsPattern,
  }) {
    // Parse command-line options for test execution.
    program
      .option(
        '--grep <pattern>',
        'Run only tests where filename matches a regex pattern'
      )
      .option('--watch', 'Continuously run tests (default: false)', false)
      .parse(process.argv);
  
    const { grep, watch } = program.opts();
    const singleRun = !watch;
  
    // Generate an entry file for the test bundle. This imports all the test
    // modules, filtered by the pattern specified by the `--grep` CLI option.
    const testFiles = [
      bootstrapFile,
      ...glob.sync(testsPattern).filter(path => (grep ? path.match(grep) : true)),
    ];
  
    const testSource = testFiles
      .map(path => `import "../../${path}";`)
      .join('\n');
  
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/test-inputs.js`, testSource);
  
    // Build the test bundle.
    log(`Building test bundle... (${testFiles.length} files)`);
    if (singleRun) {
      await buildJS(rollupConfig);
    } else {
      await watchJS(rollupConfig);
    }
  
    // Run the tests.
    log('Starting Karma...');
    const { default: karma } = await import('karma');
    const parsedConfig = await karma.config.parseConfig(
      path.resolve(karmaConfig),
      { singleRun }
    );
  
    return new Promise((resolve, reject) => {
      new karma.Server(parsedConfig, exitCode => {
        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`Karma run failed with status ${exitCode}`));
        }
      }).start();
  
      process.on('SIGINT', () => {
        // Give Karma a chance to handle SIGINT and cleanup, but forcibly
        // exit if it takes too long.
        setTimeout(() => {
          resolve();
          process.exit(1);
        }, 5000);
      });
    });
}
  
module.exports = {
    buildCSS,
    buildJS,
    watchJS,
    generateManifest,
    runTests
};