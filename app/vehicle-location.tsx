"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

type Props = {
  latitude: number | null;
  longitude: number | null;
  updatedAt: string | null;
};

const locationFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function loadMapSdk(): Promise<any> {
  const browser = window as unknown as Record<string, any>;
  if (browser.AMap) return Promise.resolve(browser.AMap);
  if (browser.__teslaAmapScriptPromise) return browser.__teslaAmapScriptPromise;

  const key = process.env.NEXT_PUBLIC_AMAP_KEY;
  if (!key) return Promise.reject(new Error("map key unavailable"));

  browser._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/api/tesla/energy-history/_AMapService`,
  };

  browser.__teslaAmapScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("amap-js-sdk") as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => browser.AMap ? resolve(browser.AMap) : reject(new Error("map sdk unavailable"));
    const onError = () => {
      script.remove();
      browser.__teslaAmapScriptPromise = undefined;
      reject(new Error("map sdk failed"));
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = "amap-js-sdk";
      script.async = true;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      document.head.appendChild(script);
    }
  });

  return browser.__teslaAmapScriptPromise;
}

export default function VehicleLocationCard({ latitude, longitude, updatedAt }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("正在读取位置…");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setAddress("暂无可用位置");
      setMapReady(false);
      return;
    }

    let active = true;
    let map: any;
    setAddress("正在解析位置…");
    setMapReady(false);

    void loadMapSdk().then((AMap) => {
      if (!active || !mapContainer.current) return;
      AMap.convertFrom([[longitude, latitude]], "gps", async (status: string, result: any) => {
        const point = result?.locations?.[0];
        if (!active || status !== "complete" || result?.info !== "ok" || !point) {
          if (active) setAddress("位置暂不可用");
          return;
        }

        map = new AMap.Map(mapContainer.current, {
          center: point,
          zoom: 15,
          viewMode: "2D",
          dragEnable: false,
          zoomEnable: false,
          keyboardEnable: false,
          scrollWheel: false,
          doubleClickZoom: false,
          showLabel: true,
          mapStyle: "amap://styles/normal",
        });
        map.add(new AMap.Marker({ position: point, anchor: "bottom-center" }));
        if (active) setMapReady(true);

        const key = process.env.NEXT_PUBLIC_AMAP_KEY;
        if (!key) {
          if (active) setAddress("位置已获取");
          return;
        }

        try {
          const query = new URLSearchParams({
            key,
            location: `${point.lng},${point.lat}`,
            output: "JSON",
            extensions: "base",
          });
          const response = await fetch(
            `/api/tesla/energy-history/_AMapService/v3/geocode/regeo?${query.toString()}`,
            { cache: "no-store" }
          );
          const result = await response.json();
          const formatted = result?.regeocode?.formatted_address;
          if (active) setAddress(result?.status === "1" && formatted ? formatted : "位置已获取");
        } catch {
          if (active) setAddress("位置已获取");
        }
      });
    }).catch(() => {
      if (active) setAddress("地图暂不可用");
    });

    return () => {
      active = false;
      map?.destroy?.();
    };
  }, [latitude, longitude]);

  return (
    <section className="vehicle-location-card" aria-label="车辆位置">
      <div className="vehicle-location-map" ref={mapContainer} aria-hidden="true" />
      <div className="vehicle-location-shade" />
      <div className="vehicle-location-copy">
        <p className="eyebrow"><MapPin size={14} />车辆位置</p>
        <h2>{address}</h2>
        <p>{updatedAt ? `位置更新于 ${locationFormatter.format(new Date(updatedAt))}` : "暂无位置更新时间"}</p>
      </div>
      {!mapReady && <div className="vehicle-location-map-placeholder" />}
    </section>
  );
}
