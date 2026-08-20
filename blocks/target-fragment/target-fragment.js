import { getTargetContent, trackDisplay } from '../../scripts/target-service.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Strips an AEM/xwalk content-root prefix from a repository path.
 *
 * xwalk content-fragment pickers hand back full AEM repository paths like
 * /content/<site-name>/fragments/test-page - but the EDS delivery domain
 * (aem.page / aem.live / local aem up) strips the /content/<site-name>
 * segment, so the fetchable path is just /fragments/test-page. loadFragment
 * expects the latter, delivery-relative form. Paths that don't start with
 * /content/ are returned unchanged (e.g. Google Docs-authored paths, which
 * are already delivery-relative).
 *
 * @param {string} path
 * @returns {string}
 */
function normalizeAemPath(path) {
  const match = path.match(/^\/content\/[^/]+(\/.*)$/);
  return match ? match[1] : path;
}

/**
 * Normalizes Target's decision content down to an EDS content path.
 * Supports content shaped as { path: "/fragments/x" } or as a bare string.
 * This block only ever handles path-shaped content - if the offer for a
 * given scope returns flat marketing fields instead (headline, ctaLabel,
 * etc.), there's no path here and the block falls back to authored content.
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
 * target-service returns nothing, the content isn't path-shaped, or the
 * fragment fetch fails, the block is left exactly as authored so it never
 * renders empty.
 * ------------------------------------------------------------------ */

export default async function decorate(block) {
  const decisionScope = block.dataset.decisionScope || block.textContent.trim();

  if (!decisionScope) return; // keep fallback content as authored

  block.classList.add('target-fragment-loading');

  let result;
  try {
    result = await getTargetContent(decisionScope);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[target-fragment] error retrieving content from target-service', e);
  }

  block.classList.remove('target-fragment-loading');

  if (!result) return; // keep fallback content as authored

  const { content, proposition } = result;
  const path = resolvePath(content);

  if (!path) return; // keep fallback content as authored

  const normalizedPath = normalizeAemPath(path);
  const fragment = await loadFragment(normalizedPath);

  if (!fragment) return; // keep fallback content as authored

  block.replaceChildren(...fragment.childNodes);
  block.classList.add('target-fragment-rendered');

  // Tell Target this decision was actually shown, so activity reporting
  // (views/impressions) reflects reality. Best-effort - a tracking
  // failure shouldn't affect what the visitor sees.
  if (proposition) {
    try {
      await trackDisplay(proposition);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[target-fragment] error tracking display', e);
    }
  }
}
