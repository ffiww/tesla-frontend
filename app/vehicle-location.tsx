"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { convertGpsPoints, loadAMap, reverseGeocode, type AMapApi } from "@/lib/amap-client";

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


export default function VehicleLocationCard({ latitude, longitude, updatedAt }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("正在读取位置…");
  const [addressDetails, setAddressDetails] = useState("");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setAddress("暂无可用位置");
      setAddressDetails("");
      setMapReady(false);
      return;
    }

    let active = true;
    let map: InstanceType<AMapApi["Map"]> | null = null;
    setAddress("正在解析位置…");
    setAddressDetails("");
    setMapReady(false);

    void loadAMap()
      .then(async (AMap) => {
        if (!active || !mapContainer.current) return;

        const converted = await convertGpsPoints(AMap, [[longitude, latitude]]);
        if (!active || !mapContainer.current || converted.length !== 1) {
          throw new Error("高德没有返回有效位置坐标");
        }

        const point = converted[0];
        const coordinates: [number, number] = [
          typeof point.getLng === "function" ? point.getLng() : point.lng!,
          typeof point.getLat === "function" ? point.getLat() : point.lat!,
        ];

        map = new AMap.Map(mapContainer.current, {
          center: coordinates,
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
        map.add(new AMap.Marker({ position: coordinates, anchor: "bottom-center" }));
        setMapReady(true);

        const place = await reverseGeocode(AMap, coordinates);
        if (!active) return;
        const displayName = place.name ?? place.formattedAddress;
        setAddress(displayName ?? "位置名称暂不可用");
        setAddressDetails(
          place.name && place.formattedAddress && place.name !== place.formattedAddress
            ? place.formattedAddress
            : ""
        );
      })
      .catch(() => {
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
        {addressDetails && <p className="vehicle-location-address">{addressDetails}</p>}
        <p>{updatedAt ? `位置更新于 ${locationFormatter.format(new Date(updatedAt))}` : "暂无位置更新时间"}</p>
      </div>
      {!mapReady && <div className="vehicle-location-map-placeholder" />}
    </section>
  );
}
