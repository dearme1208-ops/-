// アプリのアイコン(ホーム画面・タブ)の選択肢と、<head>のリンクの差し替え。
// 画像は public/icons/<id>/、マニフェストは public/manifest-<id>.json に用意してある

export const APP_ICON_SETTING_KEY = "app.icon";
export const DEFAULT_APP_ICON = "forest";
const CACHE_KEY = "koutei-hyo.appIcon";

export const APP_ICON_OPTIONS = [
  { id: "forest", label: "森の大樹" },
  { id: "day", label: "昼の森" },
  { id: "moon", label: "月の時計" },
  { id: "classic", label: "以前のアイコン" },
] as const;

export type AppIconId = (typeof APP_ICON_OPTIONS)[number]["id"];

export function normalizeAppIcon(v: string | null | undefined): AppIconId {
  return APP_ICON_OPTIONS.some((o) => o.id === v) ? (v as AppIconId) : DEFAULT_APP_ICON;
}

export function appIconPaths(id: string) {
  const v = normalizeAppIcon(id);
  return {
    manifest: `/manifest-${v}.json`,
    icon192: `/icons/${v}/icon-192.png`,
    icon512: `/icons/${v}/icon-512.png`,
    apple: `/icons/${v}/apple-touch-icon.png`,
  };
}

export function readCachedAppIcon(): AppIconId | null {
  try {
    const v = window.localStorage.getItem(CACHE_KEY);
    return v ? normalizeAppIcon(v) : null;
  } catch {
    return null;
  }
}

export function writeCachedAppIcon(id: string): void {
  try {
    window.localStorage.setItem(CACHE_KEY, normalizeAppIcon(id));
  } catch {
    // 使えない環境では控えを持たないだけ
  }
}

function findLinks(rel: string): HTMLLinkElement[] {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`));
}

function setHref(el: HTMLLinkElement, href: string) {
  if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

// relのリンクを1本だけにして(無ければ作る)hrefを当てる
function setSingleLink(rel: string, href: string) {
  const els = findLinks(rel);
  let el = els[0];
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  els.slice(1).forEach((x) => x.remove());
  setHref(el, href);
}

/** <head>のマニフェスト・アイコンのリンクを、選んだアイコンのものへ差し替える */
export function applyAppIcon(id: string): void {
  if (typeof document === "undefined") return;
  const p = appIconPaths(id);
  setSingleLink("manifest", p.manifest);
  setSingleLink("apple-touch-icon", p.apple);

  // icon: どのサイズのリンクも差し替える(512だけ大きい画像、ほかは192)。192/512が無ければ作る
  const icons = findLinks("icon");
  for (const sizes of ["192x192", "512x512"]) {
    if (icons.some((el) => el.getAttribute("sizes") === sizes)) continue;
    const el = document.createElement("link");
    el.rel = "icon";
    el.type = "image/png";
    el.setAttribute("sizes", sizes);
    document.head.appendChild(el);
    icons.push(el);
  }
  const seen = new Set<string>();
  for (const el of icons) {
    const sizes = el.getAttribute("sizes") ?? "";
    // 同じサイズの重複は消す
    if (seen.has(sizes)) {
      el.remove();
      continue;
    }
    seen.add(sizes);
    if (el.type && el.type !== "image/png") el.type = "image/png";
    setHref(el, sizes === "512x512" ? p.icon512 : p.icon192);
  }
}
