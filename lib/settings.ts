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
