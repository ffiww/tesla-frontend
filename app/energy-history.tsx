"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { BatteryCharging, Zap } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendDateRange = {
  from: string | null;
  to: string;
  all: boolean;
};

export type HistoryDrive = {
  id: string;
  started_at: string;
  ended_at: string | null;
  energy_used_kwh: number | null;
  distance_km: number | null;
  start_battery_level: number | null;
  end_battery_level: number | null;
};

type Point = { recorded_at: string; value: number };
type Drive = HistoryDrive;
type ChargingSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  start_battery_level: number | null;
  end_battery_level: number | null;
  energy_added_kwh: number | null;
  max_power_kw: number | null;
  charging_type: string | null;
  location_name: string | null;
};
type ChargePoint = {
  charging_session_id: string | null;
  recorded_at: string;
  battery_level: number | null;
  charge_power_kw: number | null;
};
export type EnergyHistoryData = {
  success: boolean;
  range_start?: string | null;
  range_end?: string | null;
  range_all?: boolean;
  battery?: { BatteryLevel?: Point[]; Soc?: Point[] };
  drives?: Drive[];
  charging_sessions?: ChargingSession[];
  charge_points?: ChargePoint[];
  error?: string;
};

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("zh-CN", {
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

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateKeysBetween(startDay: string, endDay: string) {
  const cursor = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${endDay}T12:00:00`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || cursor > end) {
    return [];
  }
  const keys: string[] = [];
  while (cursor <= end) {
    keys.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function dateStartTimestamp(day: string) {
  return new Date(`${day}T00:00:00`).getTime();
}

function dateAfterEndTimestamp(day: string) {
  const cursor = new Date(`${day}T00:00:00`);
  cursor.setDate(cursor.getDate() + 1);
  return cursor.getTime();
}

function adjustedDomain(
  values: number[],
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY
): [number, number] {
  if (values.length === 0) return [minimum, Math.min(maximum, minimum + 1)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.12, Math.abs(low) * 0.005, 0.5);
  const domainLow = Math.max(minimum, low - padding);
  const domainHigh = Math.min(maximum, high + padding);
  return domainHigh > domainLow
    ? [domainLow, domainHigh]
    : [domainLow, Math.min(maximum, domainLow + 1)];
}

function signedDomain(
  positiveValues: number[],
  negativeValues: number[]
): [number, number] {
  const positiveMaximum = Math.max(0, ...positiveValues);
  const negativeMaximum = Math.max(0, ...negativeValues.map((value) => Math.abs(value)));
  const positiveBound = positiveMaximum > 0 ? positiveMaximum * 1.12 : 0.5;
  const negativeBound = negativeMaximum > 0 ? negativeMaximum * 1.12 : 0.5;
  return [-negativeBound, positiveBound];
}

function alignedSignedDomain(
  positiveValues: number[],
  negativeValues: number[],
  zeroFromTop: number
): [number, number] {
  const positiveMaximum = Math.max(0, ...positiveValues);
  const negativeMaximum = Math.max(0, ...negativeValues.map((value) => Math.abs(value)));
  const ratio = Math.max(0.05, Math.min(0.95, zeroFromTop));
  const totalBound = Math.max(
    positiveMaximum > 0 ? positiveMaximum * 1.12 / ratio : 0,
    negativeMaximum > 0 ? negativeMaximum * 1.12 / (1 - ratio) : 0,
    1
  );
  return [-(1 - ratio) * totalBound, ratio * totalBound];
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


function sessionDuration(session: ChargingSession) {
  if (!session.ended_at) return "充电中";
  const start = new Date(session.started_at).getTime();
  const end = new Date(session.ended_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const minutes = Math.round((end - start) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}小时${rest}分钟` : `${rest}分钟`;
}

export default function EnergyHistory({
  dateRange,
  onHistoryLoaded,
}: {
  dateRange: TrendDateRange;
  onHistoryLoaded: (history: EnergyHistoryData) => void;
}) {
  const [history, setHistory] = useState<EnergyHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChargeSessionId, setSelectedChargeSessionId] = useState("");
  const [hiddenBatterySeries, setHiddenBatterySeries] = useState<string[]>([]);
  const [hiddenDriveSeries, setHiddenDriveSeries] = useState<string[]>([]);
  const [hiddenChargeDailySeries, setHiddenChargeDailySeries] = useState<string[]>([]);
  const [hiddenChargeSessionSeries, setHiddenChargeSessionSeries] = useState<string[]>([]);
  const toggle = (setter: Dispatch<SetStateAction<string[]>>, key: string) =>
    setter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ to: dateRange.to });
    if (dateRange.all) {
      params.set("all", "1");
    } else if (dateRange.from) {
      params.set("from", dateRange.from);
    }
    fetch(`/api/tesla/energy-history?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as EnergyHistoryData;
        if (!response.ok || !result.success) {
          throw new Error(result.error ?? "历史能量数据读取失败");
        }
        if (active) {
          setHistory(result);
          onHistoryLoaded(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "历史能量数据读取失败"
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dateRange, onHistoryLoaded]);

  const selectedDayKeys = useMemo(() => {
    const firstDay = dateRange.from ?? history?.range_start ?? dateRange.to;
    return dateKeysBetween(firstDay, dateRange.to);
  }, [dateRange, history?.range_start]);

  const batteryData = useMemo(() => {
    const points = new Map<number, { timestamp: number; battery?: number; soc?: number }>();
    for (const [name, key] of [
      ["BatteryLevel", "battery"],
      ["Soc", "soc"],
    ] as const) {
      for (const item of history?.battery?.[name] ?? []) {
        const timestamp = new Date(item.recorded_at).getTime();
        if (!Number.isFinite(timestamp)) continue;
        if (!points.has(timestamp)) points.set(timestamp, { timestamp });
        if (typeof item.value === "number" && Number.isFinite(item.value)) {
          (points.get(timestamp) as { timestamp: number; battery?: number; soc?: number })[key] = item.value;
        }
      }
    }

    const ordered = [...points.values()].sort((a, b) => a.timestamp - b.timestamp);
    if (ordered.length === 0 || selectedDayKeys.length === 0) return [];

    const startTimestamp = dateStartTimestamp(selectedDayKeys[0]);
    const endExclusive = dateAfterEndTimestamp(selectedDayKeys[selectedDayKeys.length - 1]);
    const duration = Math.max(0, endExclusive - startTimestamp);
    const baseIntervalMs = 5 * 60 * 1000;
    const intervalMs = Math.max(
      baseIntervalMs,
      Math.ceil(duration / (8000 * baseIntervalMs)) * baseIntervalMs
    );
    const timestamps = new Set<number>([startTimestamp, endExclusive - 1]);
    for (const point of ordered) {
      if (point.timestamp >= startTimestamp && point.timestamp < endExclusive) {
        timestamps.add(point.timestamp);
      }
    }
    for (
      let timestamp = startTimestamp + intervalMs;
      timestamp < endExclusive;
      timestamp += intervalMs
    ) {
      timestamps.add(timestamp);
    }

    const timeline = [...timestamps].sort((a, b) => a - b);
    let latestBattery: number | undefined;
    let latestSoc: number | undefined;
    let sourceIndex = 0;
    return timeline.map((timestamp) => {
      while (sourceIndex < ordered.length && ordered[sourceIndex].timestamp <= timestamp) {
        if (ordered[sourceIndex].battery !== undefined) latestBattery = ordered[sourceIndex].battery;
        if (ordered[sourceIndex].soc !== undefined) latestSoc = ordered[sourceIndex].soc;
        sourceIndex += 1;
      }
      return { timestamp, battery: latestBattery, soc: latestSoc };
    });
  }, [history, selectedDayKeys]);

  const driveDailyData = useMemo(() => {
    const groups = new Map<string, {
      day: string;
      energyKwh: number;
      batteryPct: number;
      driveCount: number;
      batterySampleCount: number;
    }>();
    for (const drive of history?.drives ?? []) {
      const day = localDayKey(drive.started_at);
      const item = groups.get(day) ?? {
        day,
        energyKwh: 0,
        batteryPct: 0,
        driveCount: 0,
        batterySampleCount: 0,
      };
      item.energyKwh += drive.energy_used_kwh ?? 0;
      if (drive.start_battery_level != null && drive.end_battery_level != null) {
        item.batteryPct += drive.start_battery_level - drive.end_battery_level;
        item.batterySampleCount += 1;
      }
      item.driveCount += 1;
      groups.set(day, item);
    }
    return selectedDayKeys.map((day) => {
      const item = groups.get(day);
      return {
        day,
        energyKwh: item?.energyKwh ?? 0,
        batteryPct: item ? (item.batterySampleCount > 0 ? item.batteryPct : null) : 0,
        driveCount: item?.driveCount ?? 0,
      };
    });
  }, [history?.drives, selectedDayKeys]);

  const chargeData = useMemo(
    () =>
      (history?.charging_sessions ?? [])
        .map((session) => ({
          ...session,
          label: dateOnly.format(new Date(session.started_at)),
        }))
        .sort((a, b) => a.started_at.localeCompare(b.started_at)),
    [history]
  );

  const chargeDailyData = useMemo(() => {
    const groups = new Map<string, {
      day: string;
      energyKwh: number;
      batteryPct: number;
      sessionCount: number;
      batterySampleCount: number;
    }>();
    for (const session of chargeData) {
      const day = localDayKey(session.started_at);
      const item = groups.get(day) ?? {
        day,
        energyKwh: 0,
        batteryPct: 0,
        sessionCount: 0,
        batterySampleCount: 0,
      };
      item.energyKwh += session.energy_added_kwh ?? 0;
      if (session.start_battery_level != null && session.end_battery_level != null) {
        item.batteryPct += session.end_battery_level - session.start_battery_level;
        item.batterySampleCount += 1;
      }
      item.sessionCount += 1;
      groups.set(day, item);
    }
    return selectedDayKeys.map((day) => {
      const item = groups.get(day);
      return {
        day,
        energyKwh: item?.energyKwh ?? 0,
        batteryPct: item ? (item.batterySampleCount > 0 ? item.batteryPct : null) : 0,
        sessionCount: item?.sessionCount ?? 0,
      };
    });
  }, [chargeData, selectedDayKeys]);

  const combinedDailyData = useMemo(
    () =>
      selectedDayKeys.map((day, index) => {
        const drive = driveDailyData[index];
        const charge = chargeDailyData[index];
        return {
          day,
          driveEnergyKwh: drive?.energyKwh ?? 0,
          driveBatteryPct: drive?.batteryPct ?? (drive?.driveCount ? null : 0),
          chargeEnergyKwh: -(charge?.energyKwh ?? 0),
          chargeBatteryPct: charge?.batteryPct == null ? null : -charge.batteryPct,
        };
      }),
    [selectedDayKeys, driveDailyData, chargeDailyData]
  );

  const chargePoints = useMemo(
    () =>
      (history?.charge_points ?? [])
        .filter((point) => point.charging_session_id === selectedChargeSessionId)
        .map((point) => ({
          timestamp: new Date(point.recorded_at).getTime(),
          battery: point.battery_level,
          power: point.charge_power_kw,
        }))
        .filter((point) => Number.isFinite(point.timestamp))
        .sort((a, b) => a.timestamp - b.timestamp),
    [history, selectedChargeSessionId]
  );

  useEffect(() => {
    if (!chargeData.length) return;
    if (!chargeData.some((session) => session.id === selectedChargeSessionId)) {
      setSelectedChargeSessionId(chargeData[chargeData.length - 1].id);
    }
  }, [chargeData, selectedChargeSessionId]);

  const selectedCharge = useMemo(
    () => chargeData.find((session) => session.id === selectedChargeSessionId) ?? null,
    [chargeData, selectedChargeSessionId]
  );
  const batteryValues = batteryData.flatMap((point) =>
    [hiddenBatterySeries.includes("battery") ? null : point.battery, hiddenBatterySeries.includes("soc") ? null : point.soc]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  );
  const batteryDomain = adjustedDomain(batteryValues, 0, 100);
  const driveEnergyValues = hiddenDriveSeries.includes("energyKwh")
    ? []
    : combinedDailyData.map((item) => item.driveEnergyKwh);
  const chargeEnergyValues = hiddenChargeDailySeries.includes("energyKwh")
    ? []
    : combinedDailyData.map((item) => item.chargeEnergyKwh);
  const energyDomain = signedDomain(driveEnergyValues, chargeEnergyValues);
  const energyZeroFromTop = energyDomain[1] / (energyDomain[1] - energyDomain[0]);
  const drivePercentageValues = hiddenDriveSeries.includes("batteryPct")
    ? []
    : combinedDailyData.map((item) => item.driveBatteryPct).filter((value): value is number => value != null);
  const chargePercentageValues = hiddenChargeDailySeries.includes("batteryPct")
    ? []
    : combinedDailyData.map((item) => item.chargeBatteryPct).filter((value): value is number => value != null);
  const percentageDomain = alignedSignedDomain(
    drivePercentageValues,
    chargePercentageValues,
    energyZeroFromTop
  );
  const sessionBatteryDomain = adjustedDomain(
    chargePoints.map((point) => point.battery).filter((value): value is number => value != null && !hiddenChargeSessionSeries.includes("battery")),
    0,
    100
  );
  const sessionPowerDomain = adjustedDomain(
    chargePoints.map((point) => point.power).filter((value): value is number => value != null && !hiddenChargeSessionSeries.includes("power"))
  );

  return (
    <article className="drive-history-card energy-history-card">
      <div className="drive-history-heading">
        <h2>电量与能耗</h2>
        <BatteryCharging size={20} />
      </div>

      {loading ? (
        <div className="energy-history-empty">正在读取历史数据…</div>
      ) : error ? (
        <div className="energy-history-empty">{error}</div>
      ) : (
        <>
          <section className="energy-module" aria-label="电量与行程耗电">
            <div className="energy-module-heading">
              <h3>电量与行程耗电</h3>
            </div>
            <div className="energy-overview-grid energy-trend-grid">
              <div className="energy-panel">
                <div className="energy-panel-heading">
                  <strong>电量趋势</strong>
                  <span>电池电量 · SOC</span>
                </div>
                {batteryData.length < 2 ? (
                  <div className="energy-history-empty">
                    暂无足够的历史电量采样，车辆收到遥测后会逐步形成趋势。
                  </div>
                ) : (
                  <div className="energy-history-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={batteryData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(value) => dateOnly.format(new Date(value))}
                          minTickGap={28}
                          tick={{ fontSize: 10, fill: "#858991" }}
                        />
                        {(!hiddenBatterySeries.includes("battery") || !hiddenBatterySeries.includes("soc")) && <YAxis domain={batteryDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "%")} tick={{ fontSize: 10, fill: "#858991" }} />}
                        <Tooltip
                          labelFormatter={(value) => dateTime.format(new Date(value))}
                          formatter={(value, name) => [
                            `${Number(value).toFixed(1)}%`,
                            name === "battery" ? "电池电量" : "SOC",
                          ]}
                        />
                        {!hiddenBatterySeries.includes("battery") && <Line type="stepAfter" dataKey="battery" name="battery" stroke="#e82127" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
                        {!hiddenBatterySeries.includes("soc") && <Line type="stepAfter" dataKey="soc" name="soc" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                    <ClickableChartLegend
                      items={[{ key: "battery", label: "电池电量 · %", color: "#e82127" }, { key: "soc", label: "SOC · %", color: "#3186c8" }]}
                      hidden={hiddenBatterySeries}
                      onToggle={(key) => toggle(setHiddenBatterySeries, key)}
                    />
                  </div>
                )}
              </div>

              <div className="energy-panel daily-energy-panel">
                <div className="energy-panel-heading">
                  <strong>每日能耗与充电</strong>
                  <span>零线上方为行程耗电，下方为充电</span>
                </div>
                {combinedDailyData.length === 0 ? (
                  <div className="energy-history-empty">所选周期没有有效日期。</div>
                ) : (
                  <div className="daily-energy-chart-layout">
                    <div className="daily-energy-chart-plot">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={combinedDailyData}
                          margin={{ top: 10, right: 6, left: 2, bottom: 0 }}
                        >
                          <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="day"
                            tickFormatter={(value) => dateOnly.format(new Date(`${value}T12:00:00`))}
                            minTickGap={24}
                            tick={{ fontSize: 10, fill: "#858991" }}
                          />
                          <YAxis
                            yAxisId="energy"
                            width={66}
                            domain={energyDomain}
                            allowDataOverflow
                            tickFormatter={(value) => formatAxisTick(Number(value), "kWh")}
                            tick={{ fontSize: 10, fill: "#858991" }}
                          />
                          <YAxis
                            yAxisId="percentage"
                            orientation="right"
                            width={58}
                            domain={percentageDomain}
                            allowDataOverflow
                            tickFormatter={(value) => formatAxisTick(Number(value), "%")}
                            tick={{ fontSize: 10, fill: "#858991" }}
                          />
                          <ReferenceLine y={0} yAxisId="energy" stroke="#626770" strokeWidth={1.4} />
                          <Tooltip
                            labelFormatter={(value) => `日期：${dateOnly.format(new Date(`${value}T12:00:00`))}`}
                            formatter={(value, name) => {
                              const number = Math.abs(Number(value));
                              if (name === "driveEnergyKwh") return [`${number.toFixed(2)} kWh`, "行程耗电"];
                              if (name === "chargeEnergyKwh") return [`${number.toFixed(2)} kWh`, "充入电量"];
                              if (name === "driveBatteryPct") return [`${number.toFixed(1)}%`, "耗电百分比"];
                              return [`${number.toFixed(1)}%`, "充电百分比"];
                            }}
                          />
                          {!hiddenDriveSeries.includes("energyKwh") && (
                            <Bar yAxisId="energy" dataKey="driveEnergyKwh" name="driveEnergyKwh" stackId="daily-energy" barSize={13} fill="#e82127" radius={[4, 4, 0, 0]} />
                          )}
                          {!hiddenChargeDailySeries.includes("energyKwh") && (
                            <Bar yAxisId="energy" dataKey="chargeEnergyKwh" name="chargeEnergyKwh" stackId="daily-energy" barSize={13} fill="#3186c8" radius={[0, 0, 4, 4]} />
                          )}
                          {!hiddenDriveSeries.includes("batteryPct") && (
                            <Line yAxisId="percentage" type="monotone" dataKey="driveBatteryPct" name="driveBatteryPct" stroke="#f28e2b" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                          )}
                          {!hiddenChargeDailySeries.includes("batteryPct") && (
                            <Line yAxisId="percentage" type="monotone" dataKey="chargeBatteryPct" name="chargeBatteryPct" stroke="#26a69a" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <ClickableChartLegend
                      items={[
                        { key: "energyKwh", label: "行程耗电 · kWh", color: "#e82127" },
                        { key: "batteryPct", label: "耗电百分比 · %", color: "#f28e2b" },
                        { key: "chargeEnergyKwh", label: "充入电量 · kWh", color: "#3186c8" },
                        { key: "chargeBatteryPct", label: "充电百分比 · %", color: "#26a69a" },
                      ]}
                      hidden={[
                        ...hiddenDriveSeries,
                        ...(hiddenChargeDailySeries.includes("energyKwh") ? ["chargeEnergyKwh"] : []),
                        ...(hiddenChargeDailySeries.includes("batteryPct") ? ["chargeBatteryPct"] : []),
                      ]}
                      onToggle={(key) => {
                        if (key === "energyKwh" || key === "batteryPct") {
                          toggle(setHiddenDriveSeries, key);
                        } else if (key === "chargeEnergyKwh") {
                          toggle(setHiddenChargeDailySeries, "energyKwh");
                        } else {
                          toggle(setHiddenChargeDailySeries, "batteryPct");
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

<section className="energy-module charging-module" aria-label="充电记录">
            <div className="energy-module-heading">
              <h3>单次充电详情</h3>
              <Zap size={18} />
            </div>
            {chargeData.length === 0 ? (
              <div className="energy-history-empty">
                所选周期内没有单次充电记录。
              </div>
            ) : (
              <>
                <div className="charge-session-layout">
                  <div className="charge-session-list" aria-label="单次充电记录">
                    <div className="charge-session-list-title">单次充电</div>
                    {chargeData.slice().reverse().map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className={session.id === selectedChargeSessionId ? "charge-session-list-item active" : "charge-session-list-item"}
                        onClick={() => setSelectedChargeSessionId(session.id)}
                      >
                        <strong>{dateTime.format(new Date(session.started_at))}</strong>
                        <span>
                          {session.energy_added_kwh == null ? "—" : `${session.energy_added_kwh.toFixed(1)} kWh`}
                          {session.charging_type ? ` · ${session.charging_type}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="charge-session-detail">
                    {selectedCharge ? (
                      <>
                        <div className="charge-session-summary">
                          <div className="charge-session-summary-heading">
                            <strong>{dateTime.format(new Date(selectedCharge.started_at))}</strong>
                            <span>
                              {[selectedCharge.charging_type, sessionDuration(selectedCharge), selectedCharge.location_name]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                          <div className="charge-session-summary-metrics">
                            <span>充入电量<strong>{selectedCharge.energy_added_kwh == null ? "—" : `${selectedCharge.energy_added_kwh.toFixed(2)} kWh`}</strong></span>
                            <span>电量变化<strong>{selectedCharge.start_battery_level == null || selectedCharge.end_battery_level == null ? "—" : `${selectedCharge.start_battery_level}% → ${selectedCharge.end_battery_level}%`}</strong></span>
                            <span>峰值功率<strong>{selectedCharge.max_power_kw == null ? "—" : `${selectedCharge.max_power_kw.toFixed(1)} kW`}</strong></span>
                          </div>
                        </div>

                        {chargePoints.length < 2 ? (
                          <div className="energy-history-empty">这次充电没有足够的过程采样点。</div>
                        ) : (
                          <>
                            <div className="energy-history-chart charge-session-chart">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chargePoints} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                                  <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="timestamp"
                                    tickFormatter={(value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))}
                                    minTickGap={28}
                                    tick={{ fontSize: 10, fill: "#858991" }}
                                  />
                                  {!hiddenChargeSessionSeries.includes("battery") && <YAxis yAxisId="battery" domain={sessionBatteryDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "%")} tick={{ fontSize: 10, fill: "#858991" }} />}
                                  {!hiddenChargeSessionSeries.includes("power") && <YAxis yAxisId="power" orientation="right" domain={sessionPowerDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "kW")} tick={{ fontSize: 10, fill: "#858991" }} />}
                                  <Tooltip
                                    labelFormatter={(value) => dateTime.format(new Date(value))}
                                    formatter={(value, name) => [
                                      value == null ? "—" : `${Number(value).toFixed(1)} ${name === "battery" ? "%" : "kW"}`,
                                      name === "battery" ? "电池电量" : "充电功率",
                                    ]}
                                  />
                                  {!hiddenChargeSessionSeries.includes("battery") && <Line yAxisId="battery" type="monotone" dataKey="battery" name="battery" stroke="#e82127" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
                                  {!hiddenChargeSessionSeries.includes("power") && <Line yAxisId="power" type="monotone" dataKey="power" name="power" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}

                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            <ClickableChartLegend items={[{ key: "battery", label: "电池电量 · %", color: "#e82127" }, { key: "power", label: "充电功率 · kW", color: "#3186c8" }]} hidden={hiddenChargeSessionSeries} onToggle={(key) => toggle(setHiddenChargeSessionSeries, key)} />
                          </>
                        )}
                      </>
                    ) : (
                      <div className="energy-history-empty">选择一条充电记录查看详情。</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </article>
  );
}

