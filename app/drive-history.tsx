"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Route } from "lucide-react";
import { convertGpsPoints, loadAMap, reverseGeocode, type AMapApi } from "@/lib/amap-client";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Drive = {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number | null;
  energy_used_kwh: number | null;
  efficiency_wh_km: number | null;
  average_speed_kmh: number | null;
  max_speed_kmh: number | null;
};

type Position = {
  recorded_at: string;
  latitude: number;
  longitude: number;
};

type TrendPoint = { recorded_at: string; value: number | string | null };
type Trends = Record<string, TrendPoint[]>;

type DriveListResponse = {
  success: boolean;
  drives?: Drive[];
  error?: string;
};

type DriveRouteResponse = {
  success: boolean;
  drive?: Drive;
  positions?: Position[];
  total_position_count?: number;
  trends?: Trends;
  error?: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function numberLabel(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}

function durationLabel(start: string, end: string | null) {
  if (!end) return "进行中";

  const durationMs =
    new Date(end).getTime() - new Date(start).getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "—";
  }

  const minutes = Math.round(durationMs / 60000);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return hours > 0
    ? `${hours}小时${restMinutes}分钟`
    : `${restMinutes}分钟`;
}

function RouteMap({
  points,
  onEndpointsConverted,
}: {
  points: Position[];
  onEndpointsConverted: (endpoints: { start: [number, number]; end: [number, number] } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);

  useEffect(() => {
    const valid = points.filter(
      (point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        Math.abs(point.latitude) <= 90 &&
        Math.abs(point.longitude) <= 180
    );

    const container = containerRef.current;
    if (!container || valid.length === 0) {
      onEndpointsConverted(null);
      setMapLoading(false);
      return;
    }

    let active = true;
    onEndpointsConverted(null);
    let map: InstanceType<AMapApi["Map"]> | null = null;
    setMapError(null);
    setMapLoading(true);

    const sampled =
      valid.length <= 500
        ? valid
        : Array.from({ length: 500 }, (_, index) =>
            valid[Math.round((index * (valid.length - 1)) / 499)]
          );

    void loadAMap()
      .then(async (AMap) => {
        if (!active) return;

        // Show the basemap while coordinate conversion runs.
        map = new AMap.Map(container, {
          center: [sampled[0].longitude, sampled[0].latitude],
          zoom: 13,
          viewMode: "2D",
          resizeEnable: true,
        });

        const converted = await convertGpsPoints(
          AMap,
          sampled.map((point) => [point.longitude, point.latitude])
        );
        if (!active) return;
        if (converted.length === 0) throw new Error("高德没有返回可用坐标");

        const path = converted.map((location) => [
          typeof location.getLng === "function" ? location.getLng() : location.lng!,
          typeof location.getLat === "function" ? location.getLat() : location.lat!,
        ]);
        if (path.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat))) {
          throw new Error("高德返回了无效的转换坐标");
        }

        const line = new AMap.Polyline({
          path,
          strokeColor: "#e82127",
          strokeWeight: 5,
          strokeOpacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
          showDir: true,
        });
        const start = new AMap.Marker({
          position: path[0],
          title: "行程起点",
          label: { content: "起点", direction: "top" },
        });
        const finish = new AMap.Marker({
          position: path[path.length - 1],
          title: "行程终点",
          label: { content: "终点", direction: "top" },
        });
        const overlays = [line, start, finish];
        map.add(overlays);
        map.setFitView(overlays, false, [48, 48, 48, 48]);
        onEndpointsConverted({
          start: path[0] as [number, number],
          end: path[path.length - 1] as [number, number],
        });
        setMapLoading(false);
      })
      .catch((error) => {
        if (active) {
          setMapLoading(false);
          onEndpointsConverted(null);
          setMapError(error instanceof Error ? error.message : "地图加载失败");
        }
      });

    return () => {
      active = false;
      map?.destroy();
    };
  }, [points, onEndpointsConverted]);

  const validCount = points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180
  ).length;

  if (validCount === 0) {
    return (
      <div className="route-empty">
        <Route size={22} />
        <span>这段行程还没有采集到位置点</span>
      </div>
    );
  }

  return (
    <div className="amap-route-wrap">
      <div ref={containerRef} className="amap-route-map" aria-label="高德地图行程轨迹" />
      {mapLoading && <div className="amap-route-error">正在加载高德地图和轨迹…</div>}
      {mapError && <div className="amap-route-error">{mapError}</div>}
      <div className="route-legend">
        <span><i className="route-start-dot" />起点</span>
        <span><i className="route-end-dot" />终点</span>
        <span>GPS 轨迹点 · 高德坐标转换</span>
      </div>
    </div>
  );
}

function DriveEndpointNames({
  start,
  end,
}: {
  start: [number, number] | null;
  end: [number, number] | null;
}) {
  const [places, setPlaces] = useState<{ start: string; end: string }>({
    start: "正在查询…",
    end: "正在查询…",
  });
  useEffect(() => {
    let active = true;
    if (!start || !end) {
      setPlaces({ start: "暂无位置名称", end: "暂无位置名称" });
      return () => { active = false; };
    }

    setPlaces({ start: "正在查询…", end: "正在查询…" });
    void loadAMap()
      .then(async (AMap) => {
        const startPlace = await reverseGeocode(AMap, start);
        const startName = startPlace.name ?? startPlace.formattedAddress;
        const endPlace =
          start[0] === end[0] && start[1] === end[1]
            ? startPlace
            : await reverseGeocode(AMap, end);
        const endName = endPlace.name ?? endPlace.formattedAddress;
        if (active) {
          setPlaces({
            start: startName ?? "位置名称暂不可用",
            end: endName ?? "位置名称暂不可用",
          });
        }
      })
      .catch(() => {
        if (active) setPlaces({ start: "位置名称暂不可用", end: "位置名称暂不可用" });
      });

    return () => { active = false; };
  }, [start, end]);

  return (
    <div className="drive-endpoint-names" aria-live="polite">
      <span><i className="endpoint-start-dot" />起点：{places.start}</span>
      <span><i className="endpoint-end-dot" />终点：{places.end}</span>
    </div>
  );
}

function DriveTrendChart({ trends }: { trends: Trends }) {
  const [metric, setMetric] = useState<"speed" | "battery" | "energy">("speed");
  const chartData = useMemo(() => {
    const values = new Map<number, Record<string, any>>();
    const config = [
      ["VehicleSpeed", "speed", 1.609344],
      ["BatteryLevel", "battery", 1],
      ["Soc", "soc", 1],
      ["LifetimeEnergyUsed", "energy", 1],
      ["Odometer", "odometer", 1.609344],
    ] as const;
    const firstEnergy = trends.LifetimeEnergyUsed?.find((point) => typeof point.value === "number")?.value;
    const firstOdometer = trends.Odometer?.find((point) => typeof point.value === "number")?.value;

    for (const [field, key, multiplier] of config) {
      for (const point of trends[field] ?? []) {
        if (typeof point.value !== "number") continue;
        const timestamp = new Date(point.recorded_at).getTime();
        if (!Number.isFinite(timestamp)) continue;
        if (!values.has(timestamp)) {
          values.set(timestamp, {
            timestamp,
            label: dateFormatter.format(new Date(timestamp)),
          });
        }
        const value =
          key === "energy" && typeof firstEnergy === "number"
            ? (point.value - firstEnergy) * 1000
            : key === "odometer" && typeof firstOdometer === "number"
              ? (point.value - firstOdometer) * multiplier
              : point.value * multiplier;
        values.get(timestamp)![key] = value;
      }
    }
    return [...values.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [trends]);

  const tabs = {
    speed: { label: "速度", keys: ["speed"] },
    battery: { label: "电量 / SOC", keys: ["battery", "soc"] },
    energy: { label: "能耗与里程", keys: ["energy", "odometer"] },
  } as const;
  const current = tabs[metric];
  const labels: Record<string, string> = {
    speed: "速度 (km/h)",
    battery: "电池电量 (%)",
    soc: "SOC (%)",
    energy: "行程内能耗 (Wh)",
    odometer: "行程内里程 (km)",
  };
  const rightAxisKeys = metric === "energy" ? ["odometer"] : [];
  const leftDomain = useMemo(() => {
    const values = chartData.flatMap((point) =>
      current.keys.filter((key) => !rightAxisKeys.includes(key))
        .map((key) => point[key]).filter((value) => typeof value === "number")
    );
    if (!values.length) return [0, 1] as [number, number];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const pad = Math.max((high - low) * 0.1, Math.abs(high || low || 1) * 0.015);
    return [low - pad, high + pad] as [number, number];
  }, [chartData, current.keys, rightAxisKeys]);
  const rightDomain = useMemo(() => {
    const values = chartData.map((point) => point.odometer).filter((value) => typeof value === "number");
    if (!values.length) return ["auto", "auto"] as [string, string];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const pad = Math.max((high - low) * 0.1, Math.abs(high || low || 1) * 0.015);
    return [low - pad, high + pad] as [number, number];
  }, [chartData]);
  const hasData = chartData.some((point) => current.keys.some((key) => point[key] != null));

  return (
    <div className="drive-trend-card">
      <div className="drive-detail-heading">
        <div><p className="eyebrow">行程详情</p><h3>参数变化趋势</h3></div>
        <div className="drive-trend-tabs" role="tablist" aria-label="行程趋势类型">
          {(["speed", "battery", "energy"] as const).map((key) => (
            <button key={key} type="button" className={metric === key ? "active" : ""}
              role="tab" aria-selected={metric === key} onClick={() => setMetric(key)}>
              {tabs[key].label}
            </button>
          ))}
        </div>
      </div>
      {!hasData ? (
        <div className="drive-history-empty">这段行程没有足够的遥测样本</div>
      ) : (
        <div className="drive-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 14, right: metric === "energy" ? 8 : 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
              <XAxis dataKey="timestamp"
                tickFormatter={(value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))}
                minTickGap={32} tick={{ fontSize: 11, fill: "#858991" }} />
              <YAxis yAxisId="left" width={55} domain={leftDomain} allowDataOverflow
                tick={{ fontSize: 11, fill: "#858991" }} />
              {metric === "energy" && (
                <YAxis yAxisId="right" orientation="right" width={55} domain={rightDomain} allowDataOverflow
                  tick={{ fontSize: 11, fill: "#858991" }} />
              )}
              <Tooltip
                position={{ x: 62, y: 6 }}
                cursor={{ stroke: "#8d9299", strokeDasharray: "4 4" }}
                labelFormatter={(value) => dateFormatter.format(new Date(value))}
                formatter={(value, name) => [Number(value).toFixed(2), labels[String(name)] ?? String(name)]}
                contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
              />
              <Legend verticalAlign="top" height={28}
                formatter={(value) => labels[String(value)] ?? String(value)} />
              {current.keys.map((key) => (
                <Line key={key} yAxisId={rightAxisKeys.includes(key) ? "right" : "left"}
                  type="monotone" dataKey={key} name={key}
                  stroke={key === "soc" || key === "odometer" ? "#3186c8" : "#e82127"}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="route-note">
        曲线来自本次行程时间范围内收到的 Tesla 遥测；速度按 mph 换算为 km/h，能耗和里程显示行程内变化量。
      </p>
    </div>
  );
}

export default function DriveHistory() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [routeEndpoints, setRouteEndpoints] = useState<{
    start: [number, number];
    end: [number, number];
  } | null>(null);
  const [trends, setTrends] = useState<Trends>({});
  const [positionCount, setPositionCount] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoute = useCallback(async (driveId: string) => {
    setSelectedId(driveId);
    setRouteEndpoints(null);
    setLoadingRoute(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/tesla/drive-history?drive_id=${encodeURIComponent(driveId)}`,
        { cache: "no-store" }
      );
      const result =
        (await response.json()) as DriveRouteResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "行程轨迹读取失败");
      }

      setPositions(result.positions ?? []);
      setTrends(result.trends ?? {});
      setPositionCount(result.total_position_count ?? 0);
    } catch (loadError) {
      setPositions([]);
      setRouteEndpoints(null);
      setTrends({});
      setPositionCount(0);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "行程轨迹读取失败"
      );
    } finally {
      setLoadingRoute(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingList(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/tesla/drive-history",
        { cache: "no-store" }
      );
      const result =
        (await response.json()) as DriveListResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "行程列表读取失败");
      }

      const nextDrives = result.drives ?? [];
      setDrives(nextDrives);

      if (nextDrives.length > 0) {
        await loadRoute(nextDrives[0].id);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "行程列表读取失败"
      );
    } finally {
      setLoadingList(false);
    }
  }, [loadRoute]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedDrive = useMemo(
    () => drives.find((drive) => drive.id === selectedId) ?? null,
    [drives, selectedId]
  );

  return (
    <section className="drive-history-card" aria-label="行程轨迹">
      <div className="drive-history-heading">
        <div>
          <p className="eyebrow">历史记录</p>
          <h2>行程轨迹</h2>
          <p>查看最近完成的行程、地图轨迹和行程参数变化。</p>
        </div>
        <Clock3 size={20} />
      </div>

      {error && <p className="drive-history-error">{error}</p>}

      {loadingList ? (
        <div className="drive-history-empty">正在读取行程…</div>
      ) : drives.length === 0 ? (
        <div className="drive-history-empty">暂无已完成的行程</div>
      ) : (
        <div className="drive-history-layout">
          <div className="drive-list" aria-label="最近行程">
            {drives.map((drive) => {
              const active = drive.id === selectedId;

              return (
                <button
                  className={active ? "drive-list-item active" : "drive-list-item"}
                  key={drive.id}
                  type="button"
                  onClick={() => void loadRoute(drive.id)}
                >
                  <strong>
                    {dateFormatter.format(new Date(drive.started_at))}
                  </strong>
                  <span>
                    {numberLabel(drive.distance_km)} km
                    <i>·</i>
                    {durationLabel(drive.started_at, drive.ended_at)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="drive-route-panel">
            {selectedDrive ? (
              <>
                <div className="drive-route-summary">
                  <div>
                    <strong>
                      {dateFormatter.format(
                        new Date(selectedDrive.started_at)
                      )}
                    </strong>
                    <DriveEndpointNames start={routeEndpoints?.start ?? null} end={routeEndpoints?.end ?? null} />
                    <span>
                      {numberLabel(selectedDrive.distance_km)} km
                      <i>·</i>
                      {durationLabel(
                        selectedDrive.started_at,
                        selectedDrive.ended_at
                      )}
                      <i>·</i>
                      {positionCount} 个位置点
                    </span>
                  </div>
                  <small>
                    平均 {numberLabel(selectedDrive.average_speed_kmh, 0)} km/h
                  </small>
                </div>

                <div className="drive-extra-metrics">
                  <span>
                    耗电{" "}
                    <strong>
                      {numberLabel(selectedDrive.energy_used_kwh, 2)} kWh
                    </strong>
                  </span>
                  <span>
                    能耗效率{" "}
                    <strong>
                      {numberLabel(selectedDrive.efficiency_wh_km, 0)} Wh/km
                    </strong>
                  </span>
                  <span>
                    最高速度{" "}
                    <strong>
                      {numberLabel(selectedDrive.max_speed_kmh, 0)} km/h
                    </strong>
                  </span>
                </div>

                {loadingRoute ? (
                  <div className="drive-history-empty">正在读取轨迹…</div>
                ) : (
                  <RouteMap points={positions} onEndpointsConverted={setRouteEndpoints} />
                )}
                <DriveTrendChart trends={trends} />

                <p className="route-note">
                  轨迹使用高德地图展示；按实际收到的 GPS 点连线，暂未进行道路吸附。
                </p>
              </>
            ) : (
              <div className="drive-history-empty">
                选择一段行程查看轨迹
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
