// 起動直後のちらつき(FOUC)対策。
//
// 演出テーマ・配色は設定としてIndexedDBに入っているが、IndexedDBの読み出しは非同期で、
// 最初に描画されるHTMLには間に合わない。そのため何もしないと、どのモードでも
// 「OFFモードの配色と標準の見出しが一瞬映ってから、本来のモードに切り替わる」ことになる。
//
// そこで「画面の見た目をすぐ決めてしまうもの」だけをlocalStorageにも書き写しておき、
// <head>の同期スクリプトで最初の描画の前に<html>へ当て直す。
// 正はあくまでIndexedDB側で、こちらは見た目を先に確定させるためだけの控え。
// 読み出しが済んだ時点で、実際に適用した値でこの控えを上書きする。

export const BOOT_STORAGE_KEY = "koutei.boot.v1";

export interface BootSnapshot {
  /** <html data-visual-mode> に入れる値(解決済み) */
  visualMode?: string;
  /** <html data-wording> に入れる値。"on" | "off" */
  wording?: string;
  /** --accent-rgb など、インラインで当てているCSS変数 */
  accentRgb?: string;
  inkRgb?: string;
  creamRgb?: string;
  panelRgb?: string;
  /** アプリ名(見出しとブラウザタブ) */
  title?: string;
}

export function readBootSnapshot(): BootSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BOOT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BootSnapshot) : null;
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は、単に控えが無いものとして扱う
    return null;
  }
}

/** 実際に画面へ適用した値だけを書き写す。指定したキーだけを差し替える */
export function writeBootSnapshot(patch: BootSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const current = readBootSnapshot() ?? {};
    const next = { ...current, ...patch };
    // 値が変わっていなければ書き込まない(毎描画で書きに行かないように)
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    window.localStorage.setItem(BOOT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても動作に支障は無い(次回の起動が一瞬ちらつくだけ)
  }
}

// <head>に直接埋め込む同期スクリプト。
// 最初の描画より前に走り、前回の見た目をそのまま復元する。
// あわせて data-booting を立て、本文(main)が「まだ設定を読めていないOFFの姿」で
// 一瞬映らないようにする。設定を読み終えた時点でアプリ側がこの印を外す。
// 何らかの理由でアプリが起動しきらなかった場合に本文が出ないままにならないよう、
// 保険として一定時間で自動的に外す
export const BOOT_INLINE_SCRIPT = `(function(){try{
var d=document.documentElement;
var s=null;try{s=JSON.parse(localStorage.getItem(${JSON.stringify(BOOT_STORAGE_KEY)})||"null")}catch(e){}
if(s){
if(s.visualMode)d.setAttribute("data-visual-mode",s.visualMode);
if(s.wording)d.setAttribute("data-wording",s.wording);
if(s.accentRgb)d.style.setProperty("--accent-rgb",s.accentRgb);
if(s.inkRgb)d.style.setProperty("--ink-rgb",s.inkRgb);
if(s.creamRgb)d.style.setProperty("--cream-rgb",s.creamRgb);
if(s.panelRgb)d.style.setProperty("--panel-rgb",s.panelRgb);
if(s.title)document.title=s.title;
}
d.setAttribute("data-booting","1");
setTimeout(function(){d.removeAttribute("data-booting")},4000);
}catch(e){}})();`;

// 見出しの文字だけは、<head>の時点ではまだ要素が無いので当てられない。
// ヘッダーを組み立てた直後にもう一度だけ走らせ、前回のアプリ名に差し替える。
// (Reactの再水和は「描画したい内容」と「今のDOM」を突き合わせるため、
//  ここでDOMを正しい側へ寄せておけば、水和時に書き戻されることもない)
export const BOOT_TITLE_SCRIPT = `(function(){try{
var s=JSON.parse(localStorage.getItem(${JSON.stringify(BOOT_STORAGE_KEY)})||"null");
if(!s||!s.title)return;
var h=document.querySelector("h1.app-title");
if(h){h.textContent=s.title;h.setAttribute("data-text",s.title);}
}catch(e){}})();`;
