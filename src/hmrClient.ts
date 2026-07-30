export const HMR_EVENT = 'vite-plugin-svg-spritemap:update';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Builds the client module injected into the page in dev.
 *
 * The sprite is an external document referenced by `<use href="sprite.svg#id">`,
 * so the browser will not re-fetch it just because the file changed. Pointing the
 * references at a new query string is what forces a re-resolve, which lets the
 * icons update without reloading the page.
 */
export function createHmrClient(spritePath: string): string {
  return `
if (import.meta.hot) {
  const SPRITE_PATH = ${JSON.stringify(spritePath)};
  const XLINK_NS = ${JSON.stringify(XLINK_NS)};

  function rebuild(value, timestamp) {
    const hashIndex = value.indexOf('#');
    const fragment = hashIndex === -1 ? '' : value.slice(hashIndex);
    const path = (hashIndex === -1 ? value : value.slice(0, hashIndex)).split('?')[0];

    if (!path.endsWith(SPRITE_PATH)) return null;

    return path + '?t=' + timestamp + fragment;
  }

  function refresh(timestamp) {
    let updated = 0;

    for (const use of document.querySelectorAll('use')) {
      const href = use.getAttribute('href');
      const xlinkHref = use.getAttributeNS(XLINK_NS, 'href');
      const current = href ?? xlinkHref;

      if (!current) continue;

      const next = rebuild(current, timestamp);
      if (!next) continue;

      if (href !== null) use.setAttribute('href', next);
      if (xlinkHref !== null) use.setAttributeNS(XLINK_NS, 'xlink:href', next);

      updated++;
    }

    // \`view\` mode also makes the sprite usable from <img>.
    for (const img of document.querySelectorAll('img')) {
      const current = img.getAttribute('src');
      if (!current) continue;

      const next = rebuild(current, timestamp);
      if (!next) continue;

      img.setAttribute('src', next);
      updated++;
    }

    return updated;
  }

  import.meta.hot.on(${JSON.stringify(HMR_EVENT)}, ({ timestamp }) => {
    const updated = refresh(timestamp);
    console.debug('[vite-plugin-svg-spritemap] updated ' + updated + ' reference(s)');
  });
}
`;
}
