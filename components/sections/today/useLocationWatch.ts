"use client";

import { useEffect, useRef, useState } from "react";
import { updateGeoArrivals } from "@/lib/automation";
import { haversineDistanceMeters } from "@/lib/geo";
import type { GeoPlace } from "@/lib/types";

// 位置情報を使う2つの独立した機能(移動検知・登録地点への到着検知)の監視部分。
// どちらもタブが開いている間のみ動作し、バックグラウンド/アプリを閉じている間は
// 動作しない(ブラウザの位置情報APIの制約による)。
// 位置情報コールバックは頻繁に発火するため、再レンダーを避けてrefで保持し、
// 検知した時だけstateを更新する。実際の作業の開始・打ち切りは、最新のtasks等を
// 参照できる呼び出し側のeffectで行う

// 移動検知: しきい値以上動いたら movementTick を進めて「移動を検知した」ことだけを伝える
export function useGeoMovementWatch(enabled: boolean, distanceThresholdMeters: number) {
  const [error, setError] = useState<string | null>(null);
  const [movementTick, setMovementTick] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const anchorRef = useRef<{ lat: number; lon: number } | null>(null);
  // 最後にしきい値以上動いた時刻。止まったとみなして打ち切る判定の起点
  const lastMovedAtRef = useRef<number>(Date.now());
  // 移動検知で始めた仮計測の作業ID。移動検知をOFFにしたら忘れる
  const taskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      anchorRef.current = null;
      taskIdRef.current = null;
      setError(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    anchorRef.current = null;
    lastMovedAtRef.current = Date.now();
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        const { latitude, longitude } = pos.coords;
        if (!anchorRef.current) {
          anchorRef.current = { lat: latitude, lon: longitude };
          return;
        }
        const dist = haversineDistanceMeters(anchorRef.current.lat, anchorRef.current.lon, latitude, longitude);
        if (dist >= distanceThresholdMeters) {
          anchorRef.current = { lat: latitude, lon: longitude };
          lastMovedAtRef.current = Date.now();
          setMovementTick((n) => n + 1);
        }
      },
      () => setError("位置情報を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
    );
    watchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      watchIdRef.current = null;
    };
  }, [enabled, distanceThresholdMeters]);

  return { error, movementTick, lastMovedAtRef, taskIdRef };
}

// 到着検知: 登録地点の圏内に入った瞬間を arrivedEvent として返す
export function useGeoArrivalWatch(enabled: boolean, places: GeoPlace[] | undefined) {
  const [error, setError] = useState<string | null>(null);
  const [arrivedEvent, setArrivedEvent] = useState<{ placeId: string; at: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // 地点ごとに「現在圏内にいるか」を保持し、圏内に入った瞬間だけ到着とする
  const insidePlaceIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !places || places.length === 0) {
      if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      insidePlaceIdsRef.current = new Set();
      setError(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        const { latitude, longitude } = pos.coords;
        for (const placeId of updateGeoArrivals(insidePlaceIdsRef.current, places, latitude, longitude)) {
          setArrivedEvent({ placeId, at: Date.now() });
        }
      },
      () => setError("位置情報を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
    );
    watchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      watchIdRef.current = null;
    };
  }, [enabled, places]);

  return { error, arrivedEvent };
}

// 地点到着で自動開始がONの間、画面消灯で位置監視が止まらないようWake Lockで画面を常時点灯させる。
// 対応ブラウザでのみ有効。Wake Lockはタブが非表示になるとブラウザ側で自動解除されるため、
// 再度表示された時にvisibilitychangeで再取得する。バッテリー消費が増えるため、ON時のみ限定で使う
export function useWakeLock(enabled: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setActive(false);
      setError(null);
      return;
    }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setError("この端末・ブラウザは画面常時点灯(Wake Lock)に対応していません");
      return;
    }
    let cancelled = false;
    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        wakeLockRef.current = sentinel;
        setActive(true);
        setError(null);
        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
            setActive(false);
          }
        });
      } catch {
        if (!cancelled) setError("画面常時点灯を有効にできませんでした");
      }
    }
    acquire();
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        acquire();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setActive(false);
    };
  }, [enabled]);

  return { active, error };
}
