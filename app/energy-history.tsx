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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { recorded_at: string; value: number };
type Drive = {
  id: string;
  started_at: string;
  energy_used_kwh: number | null;
  distance_km: number | null;
};
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
type HistoryResponse = {
  success: boolean;
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

export default function EnergyHistory() {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
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
    fetch("/api/tesla/energy-history", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as HistoryResponse;
        if (!response.ok || !result.success) {
          throw new Error(result.error ?? "历史能量数据读取失败");
        }
        if (active) setHistory(result);
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
  }, []);

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
    let latestBattery: number | undefined;
    let latestSoc: number | undefined;
    return ordered.map((point) => {
      if (point.battery !== undefined) latestBattery = point.battery;
      if (point.soc !== undefined) latestSoc = point.soc;
      return {
        ...point,
        battery: point.battery ?? latestBattery,
        soc: point.soc ?? latestSoc,
      };
    });
  }, [history]);

  const driveDailyData = useMemo(() => {
    const groups = new Map<string, { day: string; energyKwh: number; distanceKm: number; driveCount: number }>();
    for (const drive of history?.drives ?? []) {
      const day = localDayKey(drive.started_at);
      const item = groups.get(day) ?? { day, energyKwh: 0, distanceKm: 0, driveCount: 0 };
      item.energyKwh += drive.energy_used_kwh ?? 0;
      item.distanceKm += drive.distance_km ?? 0;
      item.driveCount += 1;
      groups.set(day, item);
    }
    return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [history]);

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
      maxPowerKw: number | null;
      sessionCount: number;
    }>();
    for (const session of chargeData) {
      const day = localDayKey(session.started_at);
      const item = groups.get(day) ?? {
        day,
        energyKwh: 0,
        maxPowerKw: null,
        sessionCount: 0,
      };
      item.energyKwh += session.energy_added_kwh ?? 0;
      item.maxPowerKw = session.max_power_kw == null
        ? item.maxPowerKw
        : Math.max(item.maxPowerKw ?? 0, session.max_power_kw);
      item.sessionCount += 1;
      groups.set(day, item);
    }
    return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [chargeData]);

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
  const driveEnergyDomain = adjustedDomain(hiddenDriveSeries.includes("energyKwh") ? [] : driveDailyData.map((item) => item.energyKwh));
  const chargeEnergyDomain = adjustedDomain(hiddenChargeDailySeries.includes("energyKwh") ? [] : chargeDailyData.map((item) => item.energyKwh));
  const chargePowerDomain = adjustedDomain(
    hiddenChargeDailySeries.includes("maxPowerKw") ? [] : chargeDailyData.map((item) => item.maxPowerKw ?? 0)
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
            <div className="energy-overview-grid">
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

              <div className="energy-panel">
                <div className="energy-panel-heading">
                  <strong>按日行程耗电</strong>
                  <span>单位：kWh</span>
                </div>
                {driveDailyData.length === 0 ? (
                  <div className="energy-history-empty">近 90 天没有已完成的行程记录。</div>
                ) : (
                  <div className="energy-history-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={driveDailyData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(value) => dateOnly.format(new Date(`${value}T12:00:00`))}
                          minTickGap={24}
                          tick={{ fontSize: 10, fill: "#858991" }}
                        />
                        {!hiddenDriveSeries.includes("energyKwh") && <YAxis yAxisId="energy" domain={driveEnergyDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "kWh")} tick={{ fontSize: 10, fill: "#858991" }} />}
                        <Tooltip
                          labelFormatter={(value) => `日期：${dateOnly.format(new Date(`${value}T12:00:00`))}`}
                          formatter={(value) => [`${Number(value).toFixed(2)} kWh`, "行程耗电"]}
                        />
                        {!hiddenDriveSeries.includes("energyKwh") && <Bar yAxisId="energy" dataKey="energyKwh" name="energyKwh" fill="#e82127" radius={[5, 5, 0, 0]} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                    <ClickableChartLegend items={[{ key: "energyKwh", label: "行程耗电 · kWh", color: "#e82127" }]} hidden={hiddenDriveSeries} onToggle={(key) => toggle(setHiddenDriveSeries, key)} />
                    <p className="energy-history-note">按行程日期汇总；每个日期统计该日所有行程的能耗。</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="energy-module charging-module" aria-label="充电记录">
            <div className="energy-module-heading">
              <h3>充电记录</h3>
              <Zap size={18} />
            </div>
            {chargeDailyData.length === 0 ? (
              <div className="energy-history-empty">
                近 90 天没有充电会话记录；收到充电遥测后会显示按日趋势和单次充电详情。
              </div>
            ) : (
              <>
                <div className="energy-panel charge-daily-panel">
                  <div className="energy-panel-heading">
                    <strong>按日期充电</strong>
                    <span>充入电量 · 峰值功率</span>
                  </div>
                  <div className="energy-history-chart charge-daily-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chargeDailyData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(value) => dateOnly.format(new Date(`${value}T12:00:00`))}
                          minTickGap={24}
                          tick={{ fontSize: 10, fill: "#858991" }}
                        />
                        {!hiddenChargeDailySeries.includes("energyKwh") && <YAxis yAxisId="energy" domain={chargeEnergyDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "kWh")} tick={{ fontSize: 10, fill: "#858991" }} />}
                        {!hiddenChargeDailySeries.includes("maxPowerKw") && <YAxis yAxisId="power" orientation="right" domain={chargePowerDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(Number(value), "kW")} tick={{ fontSize: 10, fill: "#858991" }} />}
                        <Tooltip
                          labelFormatter={(value) => `充电日期：${dateOnly.format(new Date(`${value}T12:00:00`))}`}
                          formatter={(value, name) => [
                            value == null ? "—" : `${Number(value).toFixed(1)} ${name === "energyKwh" ? "kWh" : "kW"}`,
                            name === "energyKwh" ? "当日充入电量" : "当日最高功率",
                          ]}
                        />
                        {!hiddenChargeDailySeries.includes("energyKwh") && <Bar yAxisId="energy" dataKey="energyKwh" name="energyKwh" fill="#e82127" radius={[5, 5, 0, 0]} />}
                        {!hiddenChargeDailySeries.includes("maxPowerKw") && <Line yAxisId="power" dataKey="maxPowerKw" name="maxPowerKw" stroke="#3186c8" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <ClickableChartLegend items={[{ key: "energyKwh", label: "当日充入电量 · kWh", color: "#e82127" }, { key: "maxPowerKw", label: "当日最高功率 · kW", color: "#3186c8" }]} hidden={hiddenChargeDailySeries} onToggle={(key) => toggle(setHiddenChargeDailySeries, key)} />
                  <p className="energy-history-note">按自然日汇总；柱形为充入电量，曲线为峰值功率。</p>
                </div>

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
