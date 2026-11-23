"use client";

import { useEffect } from "react";
import { useSettingLoaded, useSetting } from "@/lib/settings";
import {
  APP_ICON_SETTING_KEY,
  DEFAULT_APP_ICON,
  applyAppIcon,
  readCachedAppIcon,
  writeCachedAppIcon,
} from "@/lib/appIcon";

// 設定「アプリのアイコン」を<head>のマニフェスト・アイコンのリンクへ反映する。
// IndexedDBの読み出しを待つ間は、localStorageの控えを先に当ててちらつきを減らす
export default function AppIconSync() {
  const [icon] = useSetting(APP_ICON_SETTING_KEY, DEFAULT_APP_ICON);
  const loaded = useSettingLoaded(APP_ICON_SETTING_KEY);

  useEffect(() => {
    const cached = readCachedAppIcon();
    if (cached) applyAppIcon(cached);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    applyAppIcon(icon);
    writeCachedAppIcon(icon);
  }, [icon, loaded]);

  return null;
}
