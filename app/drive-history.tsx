"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Route } from "lucide-react";
import { convertGpsPoints, loadAMap, reverseGeocode, type AMapApi } from "@/lib/amap-client";
import {
  CartesianGrid,
  ComposedChart,
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
  has_more?: boolean;
  next_before?: string | null;
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

const dayFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

function localDayKey(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function totalDurationLabel(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours > 0 ? `${hours}小时${rest}分钟` : `${rest}分钟`;
}

function numberLabel(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}

function adjustedChartDomain(
  values: number[],
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY
): [number, number] {
  if (values.length === 0) return [minimum, Math.min(maximum, minimum + 1)];

  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const padding = Math.max(span * 0.12, Math.abs(low) * 0.005, 0.5);
  const domainLow = Math.max(minimum, low - padding);
  const domainHigh = Math.min(maximum, high + padding);

  return domainHigh > domainLow
    ? [domainLow, domainHigh]
    : [domainLow, Math.min(maximum, domainLow + 1)];
}

function formatAxisTick(value: number, unit = "") {
  if (!Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const absolute = Math.abs(number);
  const compact = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: amount >= 100 ? 0 : amount >= 10 ? 1 : 2,
      useGrouping: false,
    }).format(amount);
  let label: string;
  if (absolute >= 1_000_000) label = `${compact(number / 1_000_000)}M`;
  else if (absolute >= 1_000) label = `${compact(number / 1_000)}k`;
  else label = compact(number);
  return unit ? `${label} ${unit}` : label;
}

function ClickableChartLegend({
  items,
  hidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string }[];
  hidden: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="chart-legend" aria-label="图表指标显示开关">
      {items.map((item) => {
        const active = !hidden.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            className={active ? "chart-legend-item active" : "chart-legend-item"}
            aria-pressed={active}
            onClick={() => onToggle(item.key)}
          >
            <i style={{ backgroundColor: item.color }} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}


function DailyMetricChart({
  data,
  dataKey,
  title,
  unit,
  color,
  precision = 1,
}: {
  data: DailySummaryPoint[];
  dataKey: "distanceKm" | "durationMinutes" | "energyKwh";
  title: string;
  unit: string;
  color: string;
  precision?: number;
}) {
  const values = data.map((item) => item[dataKey]).filter(Number.isFinite);
  const domain = adjustedChartDomain(values);
  const formatValue = (value: number) => `${value.toFixed(precision)} ${unit}`;

  return (
    <div className="drive-daily-metric">
      <div className="drive-daily-metric-heading">
        <strong>{title}</strong>
        <span>{unit}</span>
      </div>
      <div className="drive-daily-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 7, right: 10, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={(value) => dayFormatter.format(new Date(`${value}T12:00:00`))}
              minTickGap={28}
              tick={{ fontSize: 10, fill: "#858991" }}
            />
            <YAxis
              width={64}
              domain={domain}
              allowDataOverflow
              tickFormatter={(value) => formatAxisTick(Number(value), unit)}
              tick={{ fontSize: 10, fill: "#858991" }}
            />
            <Tooltip
              labelFormatter={(value) => `日期：${dayFormatter.format(new Date(`${value}T12:00:00`))}`}
              formatter={(value) => [formatValue(Number(value)), title]}
              contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
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
          sampled.map((point) => [point.longitude, point.latitude] as [number, number])
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
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const toggleSeries = (key: string) => setHiddenSeries((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  );
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
    const leftKeys = current.keys.filter((key) => !rightAxisKeys.includes(key) && !hiddenSeries.includes(key));
    const values = chartData.flatMap((point) =>
      leftKeys
        .map((key) => point[key])
        .filter((value): value is number => typeof value === "number")
    );
    return adjustedChartDomain(
      values,
      0,
      metric === "battery" ? 100 : Number.POSITIVE_INFINITY
    );
  }, [chartData, current.keys, metric, rightAxisKeys, hiddenSeries]);
  const rightDomain = useMemo(() => {
    const values = hiddenSeries.includes("odometer") ? [] : chartData
      .map((point) => point.odometer)
      .filter((value): value is number => typeof value === "number");
    return adjustedChartDomain(values);
  }, [chartData, hiddenSeries]);
  const hasData = chartData.some((point) => current.keys.some((key) => !hiddenSeries.includes(key) && point[key] != null));

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
                tickFormatter={(value) => formatAxisTick(Number(value), metric === "speed" ? "km/h" : metric === "battery" ? "%" : "Wh")}
                tickFormatter={(value) => formatAxisTick(Number(value), metric === "speed" ? "km/h" : metric === "battery" ? "%" : "Wh")}
                tick={{ fontSize: 11, fill: "#858991" }} />
              {metric === "energy" && !hiddenSeries.includes("odometer") && (
                <YAxis yAxisId="right" orientation="right" width={55} domain={rightDomain} allowDataOverflow
                  tickFormatter={(value) => formatAxisTick(Number(value), "km")}
                  tick={{ fontSize: 11, fill: "#858991" }} />
              )}
              <Tooltip
                position={{ x: 62, y: 6 }}
                cursor={{ stroke: "#8d9299", strokeDasharray: "4 4" }}
                labelFormatter={(value) => dateFormatter.format(new Date(value))}
                formatter={(value, name) => [formatAxisTick(Number(value), rightAxisKeys.includes(String(name)) ? "km" : metric === "speed" ? "km/h" : metric === "battery" ? "%" : "Wh"), labels[String(name)] ?? String(name)]}
                contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
              />
              {current.keys.filter((key) => !hiddenSeries.includes(key)).map((key) => (
                <Line key={key} yAxisId={rightAxisKeys.includes(key) ? "right" : "left"}
                  type="monotone" dataKey={key} name={key}
                  stroke={key === "soc" || key === "odometer" ? "#3186c8" : "#e82127"}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <ClickableChartLegend
        items={current.keys.map((key) => ({ key, label: labels[key], color: key === "soc" || key === "odometer" ? "#3186c8" : "#e82127" }))}
        hidden={hiddenSeries}
        onToggle={toggleSeries}
      />
      <p className="route-note">
        曲线来自本次行程时间范围内收到的 Tesla 遥测；速度按 mph 换算为 km/h，能耗和里程显示行程内变化量。
      </p>
    </div>
  );
}

type DailySummaryPoint = {
  day: string;
  distanceKm: number;
  durationMinutes: number;
  energyKwh: number;
  driveCount: number;
};

function DriveDailyTrendChart({
  data,
  width,
}: {
  data: DailySummaryPoint[];
  width: number;
}) {
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const toggleSeries = (key: string) => setHiddenSeries((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  );
  const distanceDomain = adjustedChartDomain(data.map((item) => item.distanceKm));
  const durationDomain = adjustedChartDomain(data.map((item) => item.durationMinutes));
  const energyDomain = adjustedChartDomain(data.map((item) => item.energyKwh));
  const labels: Record<string, string> = {
    distanceKm: "行驶里程 · km",
    durationMinutes: "驾驶时长 · 分钟",
    energyKwh: "行程耗电 · kWh",
  };

  return (
    <div className="drive-daily-chart-inner" style={{ width }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(value) => dayFormatter.format(new Date(`${value}T12:00:00`))}
            minTickGap={24}
            tick={{ fontSize: 10, fill: "#858991" }}
          />
          {!hiddenSeries.includes("distanceKm") && <YAxis
            yAxisId="distance"
            width={54}
            domain={distanceDomain}
            allowDataOverflow
            tickFormatter={(value) => formatAxisTick(Number(value), "km")}
            tick={{ fontSize: 10, fill: "#e82127" }}
          />}
          {!hiddenSeries.includes("durationMinutes") && <YAxis
            yAxisId="duration"
            orientation="right"
            width={54}
            domain={durationDomain}
            allowDataOverflow
            tickFormatter={(value) => formatAxisTick(Number(value), "分钟")}
            tick={{ fontSize: 10, fill: "#3186c8" }}
          />}
          {!hiddenSeries.includes("energyKwh") && <YAxis
            yAxisId="energy"
            orientation="right"
            mirror
            width={54}
            domain={energyDomain}
            allowDataOverflow
            tickFormatter={(value) => formatAxisTick(Number(value), "kWh")}
            tick={{ fontSize: 10, fill: "#d99019" }}
          />}
          <Tooltip
            labelFormatter={(value) => `日期：${dayFormatter.format(new Date(`${value}T12:00:00`))}`}
            formatter={(value, name) => {
              const key = String(name);
              const unit = key === "distanceKm" ? "km" : key === "durationMinutes" ? "分钟" : "kWh";
              const digits = key === "energyKwh" ? 2 : key === "distanceKm" ? 1 : 0;
              return [`${Number(value).toFixed(digits)} ${unit}`, labels[key] ?? key];
            }}
            contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
          />
          {[
            ["distanceKm", "#e82127"],
            ["durationMinutes", "#3186c8"],
            ["energyKwh", "#d99019"],
          ].filter(([key]) => !hiddenSeries.includes(String(key))).map(([key, color]) => (
            <Line
              key={key}
              yAxisId={String(key) === "distanceKm" ? "distance" : String(key) === "durationMinutes" ? "duration" : "energy"}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 2.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <ClickableChartLegend
        items={[
          { key: "distanceKm", label: labels.distanceKm, color: "#e82127" },
          { key: "durationMinutes", label: labels.durationMinutes, color: "#3186c8" },
          { key: "energyKwh", label: labels.energyKwh, color: "#d99019" },
        ]}
        hidden={hiddenSeries}
        onToggle={toggleSeries}
      />
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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreDrives, setHasMoreDrives] = useState(false);
  const [driveCursor, setDriveCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dailyChartRef = useRef<HTMLDivElement>(null);
  const previousDailyChartWidth = useRef(0);

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
      setHasMoreDrives(result.has_more === true);
      setDriveCursor(result.next_before ?? null);

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

  const loadOlderDrives = useCallback(async () => {
    if (!hasMoreDrives || loadingOlder || !driveCursor) return;

    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/tesla/drive-history?before=${encodeURIComponent(driveCursor)}`,
        { cache: "no-store" }
      );
      const result = (await response.json()) as DriveListResponse;
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "更早的行程读取失败");
      }

      const olderDrives = result.drives ?? [];
      setDrives((current) => {
        const existingIds = new Set(current.map((drive) => drive.id));
        return [...current, ...olderDrives.filter((drive) => !existingIds.has(drive.id))]
          .sort((a, b) => b.started_at.localeCompare(a.started_at));
      });
      setHasMoreDrives(result.has_more === true && olderDrives.length > 0);
      setDriveCursor(result.next_before ?? olderDrives[olderDrives.length - 1]?.started_at ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "更早的行程读取失败");
    } finally {
      setLoadingOlder(false);
    }
  }, [driveCursor, hasMoreDrives, loadingOlder]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedDrive = useMemo(
    () => drives.find((drive) => drive.id === selectedId) ?? null,
    [drives, selectedId]
  );

  const dailySummaries = useMemo(() => {
    const groups = new Map<string, {
      distanceKm: number;
      durationMinutes: number;
      energyKwh: number;
      driveCount: number;
    }>();

    for (const drive of drives) {
      const key = localDayKey(drive.started_at);
      const summary = groups.get(key) ?? {
        distanceKm: 0,
        durationMinutes: 0,
        energyKwh: 0,
        driveCount: 0,
      };
      const start = new Date(drive.started_at).getTime();
      const end = drive.ended_at ? new Date(drive.ended_at).getTime() : start;

      summary.distanceKm += drive.distance_km ?? 0;
      summary.durationMinutes += Number.isFinite(end - start) ? Math.max(0, (end - start) / 60000) : 0;
      summary.energyKwh += drive.energy_used_kwh ?? 0;
      summary.driveCount += 1;
      groups.set(key, summary);
    }

    return [...groups.entries()]
      .map(([day, summary]) => ({ day, ...summary }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [drives]);

  const dailyChartWidth = Math.max(760, dailySummaries.length * 28 + 120);
  useEffect(() => {
    const container = dailyChartRef.current;
    if (!container) return;

    const nextWidth = container.scrollWidth;
    if (previousDailyChartWidth.current === 0) {
      container.scrollLeft = Math.max(0, nextWidth - container.clientWidth);
    } else if (nextWidth > previousDailyChartWidth.current) {
      container.scrollLeft += nextWidth - previousDailyChartWidth.current;
    }
    previousDailyChartWidth.current = nextWidth;
  }, [dailySummaries.length]);

  const loadOlderFromChart = () => {
    if (dailyChartRef.current?.scrollLeft !== undefined &&
        dailyChartRef.current.scrollLeft < 60 &&
        hasMoreDrives &&
        !loadingOlder) {
      void loadOlderDrives();
    }
  };

  const loadOlderFromList = (element: HTMLDivElement) => {
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 56 &&
        hasMoreDrives &&
        !loadingOlder) {
      void loadOlderDrives();
    }
  };

  return (
    <section className="drive-history-card" aria-label="行程轨迹">
      <div className="drive-history-heading">
        <h2>历史行程</h2>
        <Clock3 size={20} />
      </div>

      {!loadingList && dailySummaries.length > 0 && (
        <div
          className="drive-daily-scroll"
          ref={dailyChartRef}
          onScroll={loadOlderFromChart}
          aria-label="按日期行程趋势图，可横向滚动查看更多历史日期"
        >
          <DriveDailyTrendChart data={dailySummaries} width={dailyChartWidth} />
        </div>
      )}

      {error && <p className="drive-history-error">{error}</p>}

      {loadingList ? (
        <div className="drive-history-empty">正在读取行程…</div>
      ) : drives.length === 0 ? (
        <div className="drive-history-empty">暂无已完成的行程</div>
      ) : (
        <div className="drive-history-layout">
          <div
            className="drive-list"
            aria-label="最近行程"
            onScroll={(event) => loadOlderFromList(event.currentTarget)}
          >
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
            {hasMoreDrives && (
              <button
                className="history-load-more"
                type="button"
                onClick={() => void loadOlderDrives()}
                disabled={loadingOlder}
              >
                {loadingOlder ? "正在读取更早行程…" : "加载更早行程"}
              </button>
            )}
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
