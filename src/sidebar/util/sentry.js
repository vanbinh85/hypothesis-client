import * as Sentry from '@sentry/browser';

import { parseConfigFragment } from '../../shared/config-fragment';
import { handleErrorsInFrames } from '../../shared/frame-error-capture';
import { warnOnce } from '../../shared/warn-once';

/**
 * @typedef SentryConfig
 * @prop {string} dsn
 * @prop {string} environment
 */

let eventsSent = 0;
const maxEventsToSendPerSession = 5;

/** @type {(() => void)|null} */
let removeFrameErrorHandler = null;

function currentScriptOrigin() {
  // It might be possible to simplify this as `url` appears to be required
  // according to the HTML spec.
  //
  // See https://html.spec.whatwg.org/multipage/webappapis.html#hostgetimportmetaproperties.
  let url = import.meta.url;
  if (!url) {
    return null;
  }
  return new URL(url).origin;
}

/**
 * Initialize the Sentry integration.
 *
 * This will activate Sentry and enable capturing of uncaught errors and
 * unhandled promise rejections.
 *
 * @param {SentryConfig} config
 */
export function init(config) {
  const scriptOrigin = currentScriptOrigin();
  const allowUrls = scriptOrigin ? [scriptOrigin] : undefined;

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,

    // Only report exceptions where the stack trace references a URL that is
    // part of our code. This reduces noise caused by third-party scripts which
    // may be injected by browser extensions.
    //
    // Sentry currently always allows exceptions to bypass this list if no
    // URL can be extracted.
    allowUrls,

    // Ignore various errors due to circumstances outside of our control.
    ignoreErrors: [
      // Ignore network request failures. Some of these ought to be
      // caught and handled better but for now we are suppressing them to
      // improve the signal-to-noise ratio.
      'Network request failed', // Standard message prefix for `FetchError` errors

      // Ignore an error that appears to come from CefSharp (embedded Chromium).
      // See https://forum.sentry.io/t/unhandledrejection-non-error-promise-rejection-captured-with-value/14062/20
      'Object Not Found Matching Id',
    ],

    release: '__VERSION__',

    // See https://docs.sentry.io/error-reporting/configuration/filtering/?platform=javascript#before-send
    beforeSend: (event, hint) => {
      if (eventsSent >= maxEventsToSendPerSession) {
        // Cap the number of events that any client instance will send, to
        // reduce the impact on our Sentry event quotas.
        //
        // Sentry implements its own server-side rate limiting in addition.
        // See https://docs.sentry.io/accounts/quotas/.
        warnOnce(
          'Client-side Sentry quota reached. No further Sentry events will be sent'
        );
        return null;
      }
      ++eventsSent;

      // Add additional debugging information for non-Error exception types
      // which Sentry can't serialize to a useful format automatically.
      //
      // See https://github.com/getsentry/sentry-javascript/issues/2210
      try {
        const originalErr = hint && hint.originalException;
        if (originalErr instanceof Event) {
          if (!event.extra) {
            event.extra = {};
          }
          Object.assign(event.extra, {
            type: originalErr.type,
            // @ts-ignore - `detail` is a property of certain event types.
            detail: originalErr.detail,
            isTrusted: originalErr.isTrusted,
          });
        }
      } catch (e) {
        // If something went wrong serializing the data, just ignore it.
      }

      return event;
    },
  });

  try {
    Sentry.setExtra('host_config', parseConfigFragment(window.location.href));
  } catch (e) {
    // Ignore errors parsing configuration.
  }

  /** @param {HTMLScriptElement} script */
  const isJavaScript = script =>
    !script.type || script.type.match(/javascript|module/);

  // Include information about the scripts on the page. This may help with
  // debugging of errors caused by scripts injected by browser extensions.
  const loadedScripts = Array.from(document.querySelectorAll('script'))
    .filter(isJavaScript)
    .map(script => script.src || '<inline>');
  Sentry.setExtra('loaded_scripts', loadedScripts);

  // Catch errors occuring in Hypothesis-related code in the host frame.
  removeFrameErrorHandler = handleErrorsInFrames((err, context) => {
    Sentry.captureException(err, {
      tags: {
        context,
      },
    });
  });
}

/**
 * Record the user ID of the logged-in user.
 *
 * See https://docs.sentry.io/platforms/javascript/#capturing-the-user
 *
 * @param {import('@sentry/browser').User|null} user
 */
export function setUserInfo(user) {
  Sentry.setUser(user);
}

/**
 * Testing aid that resets event counters and removes event handlers installed
 * by {@link init}.
 */
export function reset() {
  eventsSent = 0;
  removeFrameErrorHandler?.();
  removeFrameErrorHandler = null;
}
