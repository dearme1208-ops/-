import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export function useSetting(key: string, defaultValue: string): [string, (value: string) => void] {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  const value = row?.value ?? defaultValue;
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
