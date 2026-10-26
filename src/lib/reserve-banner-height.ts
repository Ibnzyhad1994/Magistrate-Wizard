/**
 * The offline sync banner is fixed under the nav, so on its own it would
 * cover the top of every page. While it shows, its height is published as
 * this CSS variable; page top offsets and sticky bars add it (index.css
 * declares the 0px default).
 */
export const OFFLINE_BANNER_HEIGHT_VAR = "--offline-banner-h";

type StyleTarget = Pick<ElementCSSInlineStyle, "style">;

type HeightObserver = new (
  callback: ResizeObserverCallback,
) => Pick<ResizeObserver, "observe" | "disconnect">;

/**
 * Publishes `node`'s height now and on every resize (text wrapping at a
 * phone width, the failed list opening), and returns the release, which
 * puts the offset back to zero. `root` and `Observer` are the test seams.
 */
export const reserveBannerHeight = (
  node: Element,
  root: StyleTarget = document.documentElement,
  Observer: HeightObserver = ResizeObserver,
) => {
  const publish = () => {
    const height = Math.ceil(node.getBoundingClientRect().height);
    root.style.setProperty(OFFLINE_BANNER_HEIGHT_VAR, `${height}px`);
  };
  publish();
  const observer = new Observer(publish);
  observer.observe(node);
  return () => {
    observer.disconnect();
    root.style.removeProperty(OFFLINE_BANNER_HEIGHT_VAR);
  };
};
