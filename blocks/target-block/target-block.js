import { decorateBlock, loadBlock } from '../../scripts/aem.js';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

// How long to wait for alloy.js to become available before giving up.
// Useful because alloy.js is usually loaded async/deferred and may not
// be ready yet when this block's decorate() runs.
const ALLOY_WAIT_TIMEOUT_MS = 3000;
const ALLOY_WAIT_INTERVAL_MS = 50;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Polls for window.alloy to exist (alloy.js loads async, so it may not
 * be ready yet when this block decorates).
 * @returns {Promise<Function|null>} the alloy function, or null on timeout
 */
function waitForAlloy() {
  return new Promise((resolve) => {
    if (typeof window.alloy === 'function') {
      resolve(window.alloy);
      return;
    }

    const start = Date.now();
    const interval = setInterval(() => {
      if (typeof window.alloy === 'function') {
        clearInterval(interval);
        resolve(window.alloy);
      } else if (Date.now() - start > ALLOY_WAIT_TIMEOUT_MS) {
        clearInterval(interval);
        // eslint-disable-next-line no-console
        console.warn('[target-block] timed out waiting for alloy.js');
        resolve(null);
      }
    }, ALLOY_WAIT_INTERVAL_MS);
  });
}

/**
 * Calls Adobe Target through the Alloy Web SDK (alloy.js) and returns the
 * raw content of the first decision item for the given scope.
 *
 * @param {string} decisionScope
 * @returns {Promise<*|null>} whatever content the Target offer contains
 */
async function getDecisionContent(decisionScope) {
  const alloy = await waitForAlloy();
  if (!alloy) return null;

  try {
    const result = await alloy('sendEvent', {
      renderDecisions: true,
      decisionScopes: [decisionScope],
    });

    const proposition = result?.propositions?.find(
      (p) => p.scope === decisionScope,
    );
    const item = proposition?.items?.[0];
    const rawContent = item?.data?.content;

    if (rawContent == null) return null;

    // Content can come back as an object or as a JSON string, depending on
    // how the offer was authored in Target - normalize to an object.
    if (typeof rawContent === 'string') {
      try {
        return JSON.parse(rawContent);
      } catch {
        // Not JSON - treat as a plain path/string
        return rawContent;
      }
    }
    return rawContent;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[target-block] error retrieving decision from Target', e);
    return null;
  }
}

/**
 * Normalizes decision content down to an EDS content path.
 * Supports content shaped as { path: "/fragments/x" } or as a bare string.
 *
 * @param {*} content
 * @returns {string|null}
 */
function resolvePath(content) {
  if (!content) return null;
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && typeof content.path === 'string') {
    return content.path;
  }
  return null;
}

/**
 * Fetches an EDS page/fragment as plain HTML and returns its first block
 * element.
 *
 * @param {string} path - EDS content path, e.g. /fragments/promo-block
 * @returns {Promise<HTMLElement|null>}
 */
async function fetchBlockFromPath(path) {
  try {
    const resp = await fetch(`${path}.plain.html`);
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.error(`[target-block] could not retrieve ${path}: ${resp.status}`);
      return null;
    }
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.firstElementChild;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[target-block] error fetching ${path}`, e);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Block entry point
 *
 * Authoring:
 *
 * | target-block          |
 * | ----------------------- |
 * | homepage-hero-scope     |
 *
 * The single cell holds the Target decision scope. Whatever is authored
 * in the block is treated as fallback content - if Target returns no
 * decision, or the fetch fails, the block is left exactly as authored so
 * it never renders empty.
 * ------------------------------------------------------------------ */

export default async function decorate(block) {
  const decisionScope = block.dataset.scope || block.textContent.trim();

  block.classList.add('target-block-loading');

  const content = await getDecisionContent(decisionScope);
  const path = resolvePath(content);

  if (!path) {
    block.classList.remove('target-block-loading');
    return; // keep fallback content as authored
  }

  const newBlock = await fetchBlockFromPath(path);

  block.classList.remove('target-block-loading');

  if (!newBlock) return; // keep fallback content as authored

  block.textContent = '';
  block.append(newBlock);
  decorateBlock(newBlock);
  await loadBlock(newBlock);
}
