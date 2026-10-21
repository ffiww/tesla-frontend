"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryDrive, TrendDateRange } from "./energy-history";
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
  start_battery_level: number | null;
  end_battery_level: number | null;
};

type Position = {
  recorded_at: string;
  latitude: number;
  longitude: number;
};

type TrendPoint = { recorded_at: string; value: number | string | boolean | null };
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

function calendarDayKeys(startDay: string, endDay: string) {
  const cursor = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${endDay}T12:00:00`);
  const days: string[] = [];
  while (cursor <= end) {
    days.push(localDayKey(cursor.toISOString()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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

function percentLabel(value: number | null | undefined) {
  return value == null ? "—" : `${numberLabel(value, 1)}%`;
}

function batteryConsumptionPercent(drive: Pick<Drive, "start_battery_level" | "end_battery_level">) {
  if (drive.start_battery_level == null || drive.end_battery_level == null) {
    return null;
  }
  return drive.start_battery_level - drive.end_battery_level;
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

function speedColor(
  speedKmh: number | null,
  minSpeedKmh: number,
  maxSpeedKmh: number
) {
  if (speedKmh == null) return "#9298a0";
  const ratio = maxSpeedKmh > minSpeedKmh
    ? Math.max(0, Math.min(1, (speedKmh - minSpeedKmh) / (maxSpeedKmh - minSpeedKmh)))
    : 0.5;
  const stops = [
    { position: 0, color: [216, 91, 98] },
    { position: 0.5, color: [213, 163, 73] },
    { position: 1, color: [81, 161, 123] },
  ];
  const lower = ratio <= 0.5 ? stops[0] : stops[1];
  const upper = ratio <= 0.5 ? stops[1] : stops[2];
  const localRatio = (ratio - lower.position) / (upper.position - lower.position);
  const rgb = lower.color.map((value, index) =>
    Math.round(value + (upper.color[index] - value) * localRatio)
  );
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const NO_SPEED_TREND_POINTS: TrendPoint[] = [];

function RouteMap({
  points,
  speedPoints,
  onEndpointsConverted,
}: {
  points: Position[];
  speedPoints: TrendPoint[];
  onEndpointsConverted: (endpoints: { start: [number, number]; end: [number, number] } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const legendSpeeds = speedPoints.flatMap((point) =>
    typeof point.value === "number" && Number.isFinite(point.value)
      ? [point.value * 1.609344]
      : []
  );
  const legendMinSpeedKmh =
    legendSpeeds.length > 0 ? Math.min(...legendSpeeds) : null;
  const legendMaxSpeedKmh =
    legendSpeeds.length > 0 ? Math.max(...legendSpeeds) : null;

  useEffect(() => {
    const valid = points.filter(
      (point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        Math.abs(point.latitude) <= 90 &&
        Math.abs(point.longitude) <= 180
    );
    const speeds = speedPoints
      .filter((point): point is TrendPoint & { value: number } => typeof point.value === "number")
      .map((point) => ({
        timestamp: new Date(point.recorded_at).getTime(),
        speedKmh: point.value * 1.609344,
      }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.speedKmh))
      .sort((left, right) => left.timestamp - right.timestamp);
    const minSpeedKmh = speeds.length > 0
      ? Math.min(...speeds.map((point) => point.speedKmh))
      : 0;
    const maxSpeedKmh = speeds.length > 0
      ? Math.max(...speeds.map((point) => point.speedKmh))
      : 0;

    const nearestSpeed = (recordedAt: string): number | null => {
      if (speeds.length === 0) return null;
      const timestamp = new Date(recordedAt).getTime();
      if (!Number.isFinite(timestamp)) return null;
      let low = 0;
      let high = speeds.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (speeds[middle].timestamp < timestamp) low = middle + 1;
        else high = middle;
      }
      const candidates = [speeds[low - 1], speeds[low]].filter(
        (candidate): candidate is (typeof speeds)[number] => candidate != null
      );
      if (candidates.length === 0) return null;
      const nearest = candidates.reduce((best, candidate) =>
        Math.abs(candidate.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
          ? candidate
          : best
      );
      return Math.abs(nearest.timestamp - timestamp) <= 30_000
        ? nearest.speedKmh
        : null;
    };

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

        const segments = path.slice(1).map((point, index) => {
          const startSpeed = nearestSpeed(sampled[index].recorded_at);
          const endSpeed = nearestSpeed(sampled[index + 1].recorded_at);
          const segmentSpeed =
            startSpeed != null && endSpeed != null
              ? (startSpeed + endSpeed) / 2
              : startSpeed ?? endSpeed;
          return new AMap.Polyline({
            path: [path[index], point],
            strokeColor: speedColor(segmentSpeed, minSpeedKmh, maxSpeedKmh),
            strokeWeight: 5,
            strokeOpacity: 0.9,
            lineJoin: "round",
            lineCap: "round",
          });
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
        const overlays = [...segments, start, finish];
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
  }, [points, speedPoints, onEndpointsConverted]);

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
      <div ref={containerRef} className="amap-route-map" aria-label="按行驶速度着色的高德地图行程轨迹" />
      {mapLoading && <div className="amap-route-error">正在加载高德地图和轨迹…</div>}
      {mapError && <div className="amap-route-error">{mapError}</div>}
      <div className="route-legend">
        <span><i className="route-start-dot" />起点</span>
        <span><i className="route-end-dot" />终点</span>
        <span className="route-speed-legend" aria-label={legendMinSpeedKmh == null || legendMaxSpeedKmh == null ? "速度数据暂缺" : `速度刻度，${Math.round(legendMinSpeedKmh)} 至 ${Math.round(legendMaxSpeedKmh)} 公里每小时`}>
          {legendMinSpeedKmh == null || legendMaxSpeedKmh == null ? (
            <span className="route-speed-unavailable">速度数据暂缺</span>
          ) : (
            <>
              <span className="route-speed-caption">速度 · km/h</span>
              <span className="route-speed-scale">
                <i className="route-speed-gradient" />
                <span className="route-speed-ticks">
                  <span>{Math.round(legendMinSpeedKmh)}</span>
                  <span>{Math.round((legendMinSpeedKmh + legendMaxSpeedKmh) / 2)}</span>
                  <span>{Math.round(legendMaxSpeedKmh)}</span>
                </span>
              </span>
            </>
          )}
        </span>
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
  const [metric, setMetric] = useState<"driving" | "battery" | "energy" | "pedals" | "climate" | "tires">("driving");
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const toggleSeries = (key: string) => setHiddenSeries((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  );
  const chartData = useMemo(() => {
    type TrendChartRow = {
      timestamp: number;
      label: string;
      [key: string]: number | string | boolean;
    };
    const values = new Map<number, TrendChartRow>();
    const config = [
      ["VehicleSpeed", "speed", 1.609344],
      ["LongitudinalAcceleration", "longitudinalAcceleration", 1],
      ["LateralAcceleration", "lateralAcceleration", 1],
      ["BatteryLevel", "battery", 1],
      ["Soc", "soc", 1],
      ["LifetimeEnergyUsed", "energy", 1],
      ["Odometer", "odometer", 1.609344],
      ["PedalPosition", "pedalPosition", 1],
      ["BrakePedalPos", "brakePressure", 1],
      ["InsideTemp", "insideTemp", 1],
      ["OutsideTemp", "outsideTemp", 1],
      ["TpmsPressureFl", "tireFl", 1],
      ["TpmsPressureFr", "tireFr", 1],
      ["TpmsPressureRl", "tireRl", 1],
      ["TpmsPressureRr", "tireRr", 1],
      ["DriveRail", "driveRail", 1],
    ] as const;
    const firstEnergy = trends.LifetimeEnergyUsed?.find((point) => typeof point.value === "number")?.value;
    const firstOdometer = trends.Odometer?.find((point) => typeof point.value === "number")?.value;

    for (const [field, key, multiplier] of config) {
      for (const point of trends[field] ?? []) {
        if (typeof point.value !== "number" && !(key === "driveRail" && typeof point.value === "boolean")) continue;
        const timestamp = new Date(point.recorded_at).getTime();
        if (!Number.isFinite(timestamp)) continue;
        if (!values.has(timestamp)) {
          values.set(timestamp, {
            timestamp,
            label: dateFormatter.format(new Date(timestamp)),
          });
        }
        let value: number;
        if (key === "driveRail") {
          value = point.value === true ? 1 : 0;
        } else if (typeof point.value === "number") {
          value = key === "energy" && typeof firstEnergy === "number"
            ? (point.value - firstEnergy) * 1000
            : key === "odometer" && typeof firstOdometer === "number"
              ? (point.value - firstOdometer) * multiplier
              : point.value * multiplier;
        } else {
          continue;
        }
        values.get(timestamp)![key] = value;
      }
    }
    const ordered = [...values.values()].sort((a, b) => a.timestamp - b.timestamp);
    const latest: Record<string, number | undefined> = {};
    return ordered.map((point) => {
      const filled = { ...point };
      for (const key of config.map(([, name]) => name)) {
        if (typeof filled[key] === "number") {
          latest[key] = filled[key];
        } else if (latest[key] !== undefined) {
          filled[key] = latest[key];
        }
      }
      return filled;
    });
  }, [trends]);
  const driveRailValues = (trends.DriveRail ?? [])
    .map((point) => point.value)
    .filter((value): value is boolean => typeof value === "boolean");
  const driveRailOnCount = driveRailValues.filter(Boolean).length;

  const tabs = {
    driving: { label: "速度与加速度", keys: ["speed", "longitudinalAcceleration", "lateralAcceleration"] },
    battery: { label: "电量 / SOC", keys: ["battery", "soc"] },
    energy: { label: "能耗与里程", keys: ["energy", "odometer"] },
    pedals: { label: "油门与制动", keys: ["pedalPosition", "brakePressure"] },
    climate: { label: "内外温度", keys: ["insideTemp", "outsideTemp"] },
    tires: { label: "胎压", keys: ["tireFl", "tireFr", "tireRl", "tireRr"] },
  } as const;
  const current = tabs[metric];
  const labels: Record<string, string> = {
    speed: "速度 (km/h)",
    longitudinalAcceleration: "纵向加速度 (m/s²)",
    lateralAcceleration: "横向加速度 (m/s²)",
    battery: "电池电量 (%)",
    soc: "SOC (%)",
    energy: "行程内能耗 (Wh)",
    odometer: "行程内里程 (km)",
    pedalPosition: "油门位置（原始值）",
    brakePressure: "制动主缸压力（原始值）",
    insideTemp: "车内温度 (°C)",
    outsideTemp: "车外温度 (°C)",
    tireFl: "左前胎压 (bar)",
    tireFr: "右前胎压 (bar)",
    tireRl: "左后胎压 (bar)",
    tireRr: "右后胎压 (bar)",
  };
  const colors: Record<string, string> = {
    speed: "#e82127",
    longitudinalAcceleration: "#3186c8",
    lateralAcceleration: "#815ac0",
    battery: "#e82127",
    soc: "#3186c8",
    energy: "#e82127",
    odometer: "#3186c8",
    pedalPosition: "#e82127",
    brakePressure: "#3186c8",
    insideTemp: "#e82127",
    outsideTemp: "#3186c8",
    tireFl: "#e82127",
    tireFr: "#3186c8",
    tireRl: "#815ac0",
    tireRr: "#23a36d",
  };
  const rightAxisKeys = metric === "energy"
    ? ["odometer"]
    : metric === "driving"
      ? ["longitudinalAcceleration", "lateralAcceleration"]
      : metric === "pedals"
        ? ["brakePressure"]
        : [];
  const unitForKey: Record<string, string> = {
    speed: "km/h",
    longitudinalAcceleration: "m/s²",
    lateralAcceleration: "m/s²",
    battery: "%",
    soc: "%",
    energy: "Wh",
    odometer: "km",
    pedalPosition: "",
    brakePressure: "",
    insideTemp: "°C",
    outsideTemp: "°C",
    tireFl: "bar",
    tireFr: "bar",
    tireRl: "bar",
    tireRr: "bar",
  };
  const leftDomain = useMemo(() => {
    const leftKeys = current.keys.filter((key) => !rightAxisKeys.includes(key) && !hiddenSeries.includes(key));
    const values = chartData.flatMap((point) =>
      leftKeys
        .map((key) => point[key])
        .filter((value): value is number => typeof value === "number")
    );
    const minimum = metric === "battery"
      ? 0
      : values.some((value) => value < 0)
        ? Number.NEGATIVE_INFINITY
        : 0;
    return adjustedChartDomain(
      values,
      minimum,
      metric === "battery" ? 100 : Number.POSITIVE_INFINITY
    );
  }, [chartData, current.keys, metric, rightAxisKeys, hiddenSeries]);
  const rightDomain = useMemo(() => {
    const values = chartData.flatMap((point) =>
      rightAxisKeys
        .filter((key) => !hiddenSeries.includes(key))
        .map((key) => point[key])
        .filter((value): value is number => typeof value === "number")
    );
    return adjustedChartDomain(
      values,
      values.some((value) => value < 0) ? Number.NEGATIVE_INFINITY : 0
    );
  }, [chartData, hiddenSeries, rightAxisKeys]);
  const hasData = chartData.some((point) => current.keys.some((key) => !hiddenSeries.includes(key) && point[key] != null));

  return (
    <div className="drive-trend-card">
      <div className="drive-detail-heading">
        <h3>行程参数曲线</h3>
        <div className="drive-trend-tabs" role="tablist" aria-label="行程趋势类型">
          {(["driving", "battery", "energy", "pedals", "climate", "tires"] as const).map((key) => (
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
            <LineChart data={chartData} margin={{ top: 14, right: rightAxisKeys.length ? 8 : 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
              <XAxis dataKey="timestamp"
                tickFormatter={(value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))}
                minTickGap={32} tick={{ fontSize: 11, fill: "#858991" }} />
              <YAxis yAxisId="left" width={55} domain={leftDomain} allowDataOverflow
                tickFormatter={(value) => formatAxisTick(Number(value), unitForKey[current.keys.find((key) => !rightAxisKeys.includes(key)) ?? current.keys[0]])}
                tick={{ fontSize: 11, fill: "#858991" }} />
              {rightAxisKeys.some((key) => !hiddenSeries.includes(key)) && (
                <YAxis yAxisId="right" orientation="right" width={55} domain={rightDomain} allowDataOverflow
                  tickFormatter={(value) => formatAxisTick(Number(value), unitForKey[rightAxisKeys[0]])}
                  tick={{ fontSize: 11, fill: "#858991" }} />
              )}
              <Tooltip
                position={{ x: 62, y: 6 }}
                cursor={{ stroke: "#8d9299", strokeDasharray: "4 4" }}
                labelFormatter={(value) => dateFormatter.format(new Date(value))}
                formatter={(value, name) => [formatAxisTick(Number(value), unitForKey[String(name)]), labels[String(name)] ?? String(name)]}
                contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
              />
              {current.keys.filter((key) => !hiddenSeries.includes(key)).map((key) => (
                <Line key={key} yAxisId={rightAxisKeys.includes(key) ? "right" : "left"}
                  type="stepAfter" dataKey={key} name={key}
                  stroke={colors[key]}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <ClickableChartLegend
        items={current.keys.map((key) => ({ key, label: labels[key], color: colors[key] }))}
        hidden={hiddenSeries}
        onToggle={toggleSeries}
      />
      {metric === "driving" && driveRailValues.length > 0 && (
        <p className="route-note">
          DriveRail 状态事件：已就绪 {driveRailOnCount} 条、未就绪 {driveRailValues.length - driveRailOnCount} 条；当前用于和 Gear 对照验证行程边界。
        </p>
      )}
      <p className="route-note">
        曲线按 Tesla 遥测事件时间绘制，并在事件之间延续最近值；速度按 mph 换算为 km/h。
      </p>
    </div>
  );
}

type DailySummaryPoint = {
  day: string;
  distanceKm: number;
  durationMinutes: number;
  energyKwh: number;
  batteryConsumptionPct: number | null;
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
  const labels: Record<string, string> = {
    distanceKm: "每日里程 · km",
    durationMinutes: "每日驾驶时长 · 分钟",
    energyKwh: "每日耗电量 · kWh",
    batteryConsumptionPct: "每日耗电百分比合计 · %",
  };
  const distanceDomain = adjustedChartDomain(
    hiddenSeries.includes("distanceKm") ? [] : data.map((item) => item.distanceKm)
  );
  const durationDomain = adjustedChartDomain(
    hiddenSeries.includes("durationMinutes") ? [] : data.map((item) => item.durationMinutes)
  );
  const energyDomain = adjustedChartDomain(
    hiddenSeries.includes("energyKwh") ? [] : data.map((item) => item.energyKwh)
  );
  const batteryPctValues = data
    .map((item) => item.batteryConsumptionPct)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const batteryPctDomain = adjustedChartDomain(
    hiddenSeries.includes("batteryConsumptionPct") ? [] : batteryPctValues,
    batteryPctValues.some((value) => value < 0) ? Number.NEGATIVE_INFINITY : 0
  );

  return (
    <div className="drive-daily-chart-inner" style={{ width }}>
      <div className="drive-daily-chart-stack">
        <section className="drive-daily-chart-panel" aria-label="每日里程和驾驶时长">
          <h4>每日里程与驾驶时长</h4>
          <div className="drive-daily-chart-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart syncId="daily-drive-metrics" data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" hide />
                {!hiddenSeries.includes("distanceKm") && (
                  <YAxis yAxisId="distance" width={58} domain={distanceDomain} allowDataOverflow
                    tickFormatter={(value) => formatAxisTick(Number(value), "km")}
                    tick={{ fontSize: 10, fill: "#e82127" }} />
                )}
                {!hiddenSeries.includes("durationMinutes") && (
                  <YAxis yAxisId="duration" orientation="right" width={66} domain={durationDomain} allowDataOverflow
                    tickFormatter={(value) => formatAxisTick(Number(value), "分钟")}
                    tick={{ fontSize: 10, fill: "#3186c8" }} />
                )}
                <Tooltip
                  labelFormatter={(value) => `日期：${dayFormatter.format(new Date(`${value}T12:00:00`))}`}
                  formatter={(value, name) => {
                    const key = String(name);
                    const unit = key === "distanceKm" ? "km" : "分钟";
                    const digits = key === "distanceKm" ? 1 : 0;
                    return [formatAxisTick(Number(value), unit), labels[key] ?? key];
                  }}
                  contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
                />
                {!hiddenSeries.includes("distanceKm") && (
                  <Line yAxisId="distance" type="monotone" dataKey="distanceKm" name="distanceKm"
                    stroke="#e82127" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                )}
                {!hiddenSeries.includes("durationMinutes") && (
                  <Line yAxisId="duration" type="monotone" dataKey="durationMinutes" name="durationMinutes"
                    stroke="#3186c8" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ClickableChartLegend
            items={[
              { key: "distanceKm", label: labels.distanceKm, color: "#e82127" },
              { key: "durationMinutes", label: labels.durationMinutes, color: "#3186c8" },
            ]}
            hidden={hiddenSeries}
            onToggle={toggleSeries}
          />
        </section>

        <section className="drive-daily-chart-panel" aria-label="每日耗电量和电量消耗比例">
          <h4>每日耗电量与电量消耗比例</h4>
          <div className="drive-daily-chart-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart syncId="daily-drive-metrics" data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(value) => dayFormatter.format(new Date(`${value}T12:00:00`))}
                  minTickGap={24}
                  tick={{ fontSize: 10, fill: "#858991" }}
                />
                {!hiddenSeries.includes("energyKwh") && (
                  <YAxis yAxisId="energy" width={58} domain={energyDomain} allowDataOverflow
                    tickFormatter={(value) => formatAxisTick(Number(value), "kWh")}
                    tick={{ fontSize: 10, fill: "#d99019" }} />
                )}
                {!hiddenSeries.includes("batteryConsumptionPct") && (
                  <YAxis yAxisId="batteryPct" orientation="right" width={60} domain={batteryPctDomain} allowDataOverflow
                    tickFormatter={(value) => formatAxisTick(Number(value), "%")}
                    tick={{ fontSize: 10, fill: "#8056b3" }} />
                )}
                <Tooltip
                  labelFormatter={(value) => `日期：${dayFormatter.format(new Date(`${value}T12:00:00`))}`}
                  formatter={(value, name) => {
                    const key = String(name);
                    const unit = key === "energyKwh" ? "kWh" : "%";
                    const digits = key === "energyKwh" ? 2 : 1;
                    return [formatAxisTick(Number(value), unit), labels[key] ?? key];
                  }}
                  contentStyle={{ borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)" }}
                />
                {!hiddenSeries.includes("energyKwh") && (
                  <Line yAxisId="energy" type="monotone" dataKey="energyKwh" name="energyKwh"
                    stroke="#d99019" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                )}
                {!hiddenSeries.includes("batteryConsumptionPct") && (
                  <Line yAxisId="batteryPct" type="monotone" dataKey="batteryConsumptionPct" name="batteryConsumptionPct"
                    stroke="#8056b3" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ClickableChartLegend
            items={[
              { key: "energyKwh", label: labels.energyKwh, color: "#d99019" },
              { key: "batteryConsumptionPct", label: labels.batteryConsumptionPct, color: "#8056b3" },
            ]}
            hidden={hiddenSeries}
            onToggle={toggleSeries}
          />
        </section>
      </div>
    </div>
  );
}

export default function DriveHistory({
  dateRange,
  trendDrives,
  historyStart,
}: {
  dateRange: TrendDateRange;
  trendDrives: HistoryDrive[];
  historyStart: string | null;
}) {
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
      batteryConsumptionPct: number;
      batterySampleCount: number;
      driveCount: number;
    }>();

    for (const drive of trendDrives) {
      const key = localDayKey(drive.started_at);
      const summary = groups.get(key) ?? {
        distanceKm: 0,
        durationMinutes: 0,
        energyKwh: 0,
        batteryConsumptionPct: 0,
        batterySampleCount: 0,
        driveCount: 0,
      };
      const start = new Date(drive.started_at).getTime();
      const end = drive.ended_at ? new Date(drive.ended_at).getTime() : start;

      summary.distanceKm += drive.distance_km ?? 0;
      summary.durationMinutes += Number.isFinite(end - start) ? Math.max(0, (end - start) / 60000) : 0;
      summary.energyKwh += drive.energy_used_kwh ?? 0;
      if (drive.start_battery_level != null && drive.end_battery_level != null) {
        summary.batteryConsumptionPct += drive.start_battery_level - drive.end_battery_level;
        summary.batterySampleCount += 1;
      }
      summary.driveCount += 1;
      groups.set(key, summary);
    }

    const firstDay = dateRange.from ?? historyStart ?? dateRange.to;
    return calendarDayKeys(firstDay, dateRange.to).map((day) => {
      const summary = groups.get(day) ?? {
        distanceKm: 0,
        durationMinutes: 0,
        energyKwh: 0,
        batteryConsumptionPct: 0,
        batterySampleCount: 0,
        driveCount: 0,
      };
      return {
        day,
        distanceKm: summary.distanceKm,
        durationMinutes: summary.durationMinutes,
        energyKwh: summary.energyKwh,
        batteryConsumptionPct: summary.batterySampleCount > 0 ? summary.batteryConsumptionPct : null,
        driveCount: summary.driveCount,
      };
    });
  }, [trendDrives, dateRange.from, dateRange.to, historyStart]);


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
                  <span className="drive-list-battery">
                    耗电量 {percentLabel(batteryConsumptionPercent(drive))}
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
                    电量消耗{" "}
                    <strong>
                      {percentLabel(batteryConsumptionPercent(selectedDrive))}，
                      {percentLabel(selectedDrive.start_battery_level)} → {percentLabel(selectedDrive.end_battery_level)}
                    </strong>
                  </span>
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
                  <RouteMap points={positions} speedPoints={trends.VehicleSpeed ?? NO_SPEED_TREND_POINTS} onEndpointsConverted={setRouteEndpoints} />
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

