/**
 * Bootstraps the Adobe Experience Platform Web SDK (alloy.js) and
 * configures it with your Datastream.
 *
 * Usage - call this once, as early as possible, and before any block
 * that calls window.alloy('sendEvent', ...) decorates (e.g. target-block):
 *
 *   import { initAlloy } from './alloy.js';
 *   await initAlloy();
 */

// Adobe-hosted CDN build - swap for your own first-party-hosted copy if you
// have one (recommended for ad-blocker resilience / better cache control).
const ALLOY_SRC = 'https://cdn1.adoberesources.net/alloy/2.x/alloy.min.js';

const ALLOY_CONFIG = {
  datastreamId: '3f75f0f0-4f07-482b-930a-8ef876cf2853', // Edge configuration ID from AEP Datastreams
  orgId: 'E71EADC8584130D00A495EBD@AdobeOrg', // e.g. 1234567890ABCDEF1234567@AdobeOrg
  debugEnabled: false, // flip to true while testing in dev/stage
  defaultConsent: 'in', // or 'pending' if gated behind a consent banner
  // edgeDomain: 'edge.yourdomain.com', // uncomment if using a first-party/CNAME domain
};

/**
 * Adobe's standard alloy.js stub/loader pattern. This defines window.alloy
 * as a small queueing function *before* the real library has loaded, so
 * any alloy('sendEvent', ...) calls made early (e.g. from a block that
 * decorates quickly) are queued and safely replayed once the real script
 * arrives, instead of throwing "alloy is not a function".
 */
function injectAlloyStub() {
  if (typeof window.alloy === 'function') return; // already present

  window.alloy = (...args) => new Promise((resolve, reject) => {
    (window.alloy.q = window.alloy.q || []).push([args, resolve, reject]);
  });
  window.alloy.q = [];
}

/**
 * Loads the actual alloy.js library from the CDN (or your hosted copy).
 * Safe to call multiple times - resolves immediately if already present.
 * @returns {Promise<void>}
 */
function loadAlloyLibrary() {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${ALLOY_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = ALLOY_SRC;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('[alloy] failed to load alloy.js'));
    document.head.appendChild(script);
  });
}

/**
 * Full bootstrap: injects the stub (so early sendEvent calls queue safely),
 * loads the real library, then configures it with your datastream.
 * Safe to call once per page load - subsequent calls are a no-op once
 * configuration has resolved.
 *
 * @returns {Promise<void>}
 */
let configured = false;

export default async function initAlloy() {
  injectAlloyStub();

  if (configured) return;

  try {
    await loadAlloyLibrary();
    await window.alloy('configure', ALLOY_CONFIG);
    configured = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[alloy] failed to initialize', e);
  }
}
