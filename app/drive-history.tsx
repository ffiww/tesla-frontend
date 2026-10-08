"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Route } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
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

function RouteSketch({ points }: { points: Position[] }) {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude)
  );

  if (valid.length === 0) {
    return (
      <div className="route-empty">
        <Route size={22} />
        <span>这段行程还没有采集到位置点</span>
      </div>
    );
  }

  const latitudeCenter =
    valid.reduce((sum, point) => sum + point.latitude, 0) /
    valid.length;
  const longitudeScale = Math.cos(
    (latitudeCenter * Math.PI) / 180
  );

  const projected = valid.map((point) => ({
    x: point.longitude * longitudeScale,
    y: point.latitude,
  }));

  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const rawSpanX = maxX - minX;
  const rawSpanY = maxY - minY;
  const spanX = Math.max(rawSpanX, 0.000001);
  const spanY = Math.max(rawSpanY, 0.000001);
  const padding = 28;
  const width = 720;
  const height = 340;
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const pathPoints = projected.map((point) => {
    const x =
      width / 2 + (point.x - centerX) * scale;
    const y =
      height / 2 - (point.y - centerY) * scale;

    return { x, y };
  });

  const polyline = pathPoints
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  const start = pathPoints[0];
  const end = pathPoints[pathPoints.length - 1];

  return (
    <div className="route-sketch-wrap">
      <svg
        className="route-sketch"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="本次行程位置轨迹示意图"
      >
        <defs>
          <pattern
            id="routeGrid"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="#e4e6e9"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          width={width}
          height={height}
          fill="url(#routeGrid)"
          rx="16"
        />
        {pathPoints.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="#e82127"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle
          cx={start.x}
          cy={start.y}
          r="8"
          fill="#fff"
          stroke="#1d9b62"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={end.x}
          cy={end.y}
          r="8"
          fill="#fff"
          stroke="#e82127"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="route-legend">
        <span><i className="route-start-dot" />起点</span>
        <span><i className="route-end-dot" />终点</span>
        <span>北向上 · 位置点连线示意</span>
      </div>
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
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
              <XAxis dataKey="timestamp"
                tickFormatter={(value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))}
                minTickGap={32} tick={{ fontSize: 11, fill: "#858991" }} />
              <YAxis width={55} tick={{ fontSize: 11, fill: "#858991" }} />
              <Tooltip
                labelFormatter={(value) => dateFormatter.format(new Date(value))}
                formatter={(value, name) => {
                  const labels: Record<string, string> = {
                    speed: "速度 (km/h)", battery: "电池电量 (%)", soc: "SOC (%)",
                    energy: "行程内能耗 (Wh)", odometer: "行程内里程 (km)",
                  };
                  return [Number(value).toFixed(1), labels[String(name)] ?? String(name)];
                }}
              />
              {current.keys.map((key) => (
                <Line key={key} type="monotone" dataKey={key} name={key}
                  stroke={key === "soc" || key === "odometer" ? "#3186c8" : "#e82127"}
                  strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
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
  const [trends, setTrends] = useState<Trends>({});
  const [positionCount, setPositionCount] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoute = useCallback(async (driveId: string) => {
    setSelectedId(driveId);
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
          <p>查看最近完成的行程和已采集的位置点。</p>
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
                  <RouteSketch points={positions} />
                )}
                <DriveTrendChart trends={trends} />

                <p className="route-note">
                  轨迹仅依据实际收到的位置点连线，未进行道路吸附，也不调用第三方地图。
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
