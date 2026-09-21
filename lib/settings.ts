import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { readBootSnapshot, type BootSnapshot } from "./boot";

export function useSetting(key: string, defaultValue: string): [string, (value: string) => void] {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  const value = row?.value ?? defaultValue;
  const setValue = (v: string) => {
    db.settings.put({ key, value: v });
  };
  return [value, setValue];
}

// その設定がIndexedDBから読み終わったかどうか。
// useLiveQueryは「読み込み中」も「行が無い」もundefinedで返してしまうので、
// 必ずオブジェクトを返すクエリにして、undefined=読み込み中と区別できるようにする
export function useSettingLoaded(key: string): boolean {
  const row = useLiveQuery(async () => ({ value: (await db.settings.get(key))?.value ?? null }), [key]);
  return row !== undefined;
}

// 起動直後の一瞬だけ、まだIndexedDBから読めていない設定の代わりに
// localStorageの控え(lib/boot.ts)を使う版。見た目を決めてしまう設定にだけ使う。
// これがないと、最初の描画が必ずOFFモードの姿になってしまう
export function useBootSetting(
  key: string,
  defaultValue: string,
  bootField: keyof BootSnapshot
): [string, (value: string) => void] {
  const row = useLiveQuery(async () => ({ value: (await db.settings.get(key))?.value ?? null }), [key]);
  // 初回描画で使う控え。localStorageは同期で読めるのでDBの読み出しを待たなくてよい
  const [booted] = useState<string | null>(() => {
    const snap = readBootSnapshot();
    const v = snap ? snap[bootField] : undefined;
    return typeof v === "string" ? v : null;
  });
  const value = row !== undefined ? row.value ?? defaultValue : booted ?? defaultValue;
  const setValue = (v: string) => {
    db.settings.put({ key, value: v });
  };
  return [value, setValue];
}

// useSettingと同じくDB(IndexedDB)に永続化される文字列設定だが、テキスト入力の
// value属性に直接束ねても日本語IME変換が壊れないようにしたもの。
// useSettingは書き込みのたびに非同期のDB書き込み→Dexie liveQueryのechoで
// 再レンダーが起きるため、それをcontrolledなtextarea/inputのvalueに直結すると
// 変換中に入力欄の値がプログラム的に上書きされ、IME側の変換状態が壊れてしまう
// (Androidでは1文字ごとに即確定、iPadでは確定時に大量重複入力になる等)。
// ここではキー入力を即座に反映するローカルなdraft状態を持ち、DBへの書き込みは
// 副作用として行うだけにして、DBからのechoをvalueへ跳ね返さないようにする
export function useDraftSetting(key: string, defaultValue: string): [string, (value: string) => void] {
  const [dbValue, setDbValue] = useSetting(key, defaultValue);
  const [draft, setDraft] = useState(dbValue);
  const keyRef = useRef(key);
  const editedRef = useRef(false);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      editedRef.current = false;
      setDraft(dbValue);
      return;
    }
    // まだユーザーが編集していない間は、DBからの読み込み完了(初回ロード)をdraftに反映してよい。
    // 一度でも編集した後は、自分自身の書き込みのechoでdraftを上書きしないようにする
    if (!editedRef.current) {
      setDraft(dbValue);
    }
  }, [key, dbValue]);

  function setDraftValue(v: string) {
    editedRef.current = true;
    setDraft(v);
    setDbValue(v);
  }

  return [draft, setDraftValue];
}

// 折りたたみパネルの開閉状態(キー→畳んでいるか)をDBへ永続化する版。
// useState<Record<string, boolean>>({})の代わりにこれを使うだけで、次回そのタブを
// 開いたときも畳んだ状態が残る(TodayStatusPanelの1枚版の複数パネル版)。
// setter は useState と同じ関数更新形("(prev) => next")も受け取れるので、
// 既存のsetCollapsed((c) => ({ ...c, [key]: !c[key] }))呼び出し側はそのまま使い回せる
export function useCollapsedPanels(
  settingKey: string,
  defaultCollapsed: Record<string, boolean> = {}
): [Record<string, boolean>, (updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void] {
  const [json, setJson] = useSetting(settingKey, JSON.stringify(defaultCollapsed));
  const collapsed = useMemo<Record<string, boolean>>(() => {
    try {
      const obj = JSON.parse(json);
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);
  function setCollapsed(updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) {
    const next = typeof updater === "function" ? updater(collapsed) : updater;
    setJson(JSON.stringify(next));
  }
  return [collapsed, setCollapsed];
}
