"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Route } from "lucide-react";
import { convertGpsPoints, loadAMap, reverseGeocode, type AMapApi } from "@/lib/amap-client";
import {
  CartesianGrid,
  ComposedChart,
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
          <YAxis
            yAxisId="distance"
            width={54}
            domain={distanceDomain}
            allowDataOverflow
            tick={{ fontSize: 10, fill: "#e82127" }}
          />
          <YAxis
            yAxisId="duration"
            orientation="right"
            width={54}
            domain={durationDomain}
            allowDataOverflow
            tick={{ fontSize: 10, fill: "#3186c8" }}
          />
          <YAxis
            yAxisId="energy"
            orientation="right"
            mirror
            width={54}
            domain={energyDomain}
            allowDataOverflow
            tick={{ fontSize: 10, fill: "#d99019" }}
          />
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
          <Legend formatter={(value) => labels[String(value)] ?? String(value)} />
          <Line yAxisId="distance" type="monotone" dataKey="distanceKm" name="distanceKm" stroke="#e82127" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          <Line yAxisId="duration" type="monotone" dataKey="durationMinutes" name="durationMinutes" stroke="#3186c8" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          <Line yAxisId="energy" type="monotone" dataKey="energyKwh" name="energyKwh" stroke="#d99019" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
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
