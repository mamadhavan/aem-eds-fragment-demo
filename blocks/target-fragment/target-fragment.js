import { loadFragment } from '../fragment/fragment.js';

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
        console.warn('[target-fragment] timed out waiting for alloy.js');
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
    console.error('[target-fragment] error retrieving decision from Target', e);
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
 * Strips an AEM/xwalk content-root prefix from a repository path.
 *
 * xwalk content-fragment pickers hand back full AEM repository paths like
 * /content/<site-name>/fragments/test-page - but the EDS delivery domain
 * (aem.page / aem.live / local aem up) strips the /content/<site-name>
 * segment, so the fetchable path is just /fragments/test-page. loadFragment
 * expects the latter, delivery-relative form. Paths that don't start with
 * /content/ are returned unchanged (e.g. Google Docs-authored paths).
 *
 * @param {string} path
 * @returns {string}
 */
function normalizeAemPath(path) {
  const match = path.match(/^\/content\/[^/]+(\/.*)$/);
  return match ? match[1] : path;
}

/* ------------------------------------------------------------------ *
 * Block entry point
 *
 * Authoring:
 *
 * | target-fragment        |
 * | ----------------------- |
 * | homepage-hero-scope     |
 *
 * Supports both authoring styles: xwalk writes the "decisionScope" model
 * field as a data-decision-scope attribute -> block.dataset.decisionScope;
 * the Google Docs table style puts the scope as plain text in the cell.
 *
 * Whatever is authored in the block is treated as fallback content - if
 * Target returns no decision, or the fragment fetch fails, the block is
 * left exactly as authored so it never renders empty.
 *
 * This block calls alloy.js directly (no target-service.js dependency) -
 * see target-fragment-via-service.js for the variant that delegates the
 * Target call to a shared target-service.js instead.
 * ------------------------------------------------------------------ */

export default async function decorate(block) {
  const decisionScope = block.dataset.decisionScope || block.textContent.trim();

  block.classList.add('target-fragment-loading');

  const content = await getDecisionContent(decisionScope);
  const path = resolvePath(content);

  if (!path) {
    block.classList.remove('target-fragment-loading');
    return; // keep fallback content as authored
  }

  const normalizedPath = normalizeAemPath(path);
  const fragment = await loadFragment(normalizedPath);

  block.classList.remove('target-fragment-loading');

  if (!fragment) return; // keep fallback content as authored

  block.replaceChildren(...fragment.childNodes);
}
