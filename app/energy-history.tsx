"use client";

import { useEffect, useMemo, useState } from "react";
import { BatteryCharging, Route, Zap } from "lucide-react";
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

type Tab = "battery" | "drives" | "charging";

export default function EnergyHistory() {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [tab, setTab] = useState<Tab>("battery");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChargeSessionId, setSelectedChargeSessionId] = useState<string>("");

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
        (points.get(timestamp) as any)[key] = item.value;
      }
    }
    return [...points.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [history]);

  const driveData = useMemo(
    () =>
      (history?.drives ?? []).map((drive) => ({
        ...drive,
        label: dateOnly.format(new Date(drive.started_at)),
      })),
    [history]
  );

  const chargeData = useMemo(
    () =>
      (history?.charging_sessions ?? []).map((session) => ({
        ...session,
        label: dateOnly.format(new Date(session.started_at)),
      })),
    [history]
  );

  const chargeDailyData = useMemo(() => {
    const groups = new Map<string, {
      label: string;
      daily_energy_kwh: number;
      max_power_kw: number | null;
      session_count: number;
    }>();

    for (const session of history?.charging_sessions ?? []) {
      const date = new Date(session.started_at);
      if (!Number.isFinite(date.getTime())) continue;
      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
      const item = groups.get(key) ?? {
        label: dateOnly.format(date),
        daily_energy_kwh: 0,
        max_power_kw: null,
        session_count: 0,
      };
      item.daily_energy_kwh += session.energy_added_kwh ?? 0;
      item.max_power_kw = session.max_power_kw == null
        ? item.max_power_kw
        : Math.max(item.max_power_kw ?? 0, session.max_power_kw);
      item.session_count += 1;
      groups.set(key, item);
    }

    return [...groups.entries()]
      .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
      .map(([, item]) => item);
  }, [history]);

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
    const sessions = history?.charging_sessions ?? [];
    if (!sessions.length) return;
    if (!sessions.some((session) => session.id === selectedChargeSessionId)) {
      setSelectedChargeSessionId(sessions[sessions.length - 1].id);
    }
  }, [history, selectedChargeSessionId]);

  const tabInfo = {
    battery: { label: "电量", icon: BatteryCharging },
    drives: { label: "行程耗电", icon: Route },
    charging: { label: "充电", icon: Zap },
  } as const;

  return (
    <article className="trend-card energy-history-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">历史趋势 · 近 30–90 天</p>
          <h2>电量与能耗</h2>
        </div>
        <BatteryCharging size={20} />
      </div>

      <div className="energy-history-tabs" role="tablist" aria-label="历史能量趋势">
        {(["battery", "drives", "charging"] as const).map((key) => {
          const Icon = tabInfo[key].icon;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              key={key}
              onClick={() => setTab(key)}
            >
              <Icon size={15} />
              {tabInfo[key].label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="energy-history-empty">正在读取历史数据…</div>
      ) : error ? (
        <div className="energy-history-empty">{error}</div>
      ) : tab === "battery" ? (
        batteryData.length < 2 ? (
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
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: "#858991" }} />
                <Tooltip
                  labelFormatter={(value) => dateTime.format(new Date(value))}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(1)}%`,
                    name === "battery" ? "电池电量" : "SOC",
                  ]}
                />
                <Line type="monotone" dataKey="battery" name="battery" stroke="#e82127" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="soc" name="soc" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="energy-chart-legend">
              <span><i className="legend-battery" />电池电量</span>
              <span><i className="legend-soc" />SOC</span>
            </div>
          </div>
        )
      ) : tab === "drives" ? (
        driveData.length === 0 ? (
          <div className="energy-history-empty">近 90 天没有已完成的行程记录。</div>
        ) : (
          <div className="energy-history-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={driveData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#858991" }} />
                <YAxis yAxisId="energy" unit=" kWh" tick={{ fontSize: 10, fill: "#858991" }} />
                <YAxis yAxisId="battery" orientation="right" unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: "#858991" }} />
                <Tooltip
                  labelFormatter={(value) => `行程日期：${value}`}
                  formatter={(value, name) => [
                    value == null ? "—" : Number(value).toFixed(1),
                    name === "energy_used_kwh" ? "耗电 (kWh)" : String(name),
                  ]}
                />
                <Bar yAxisId="energy" dataKey="energy_used_kwh" name="energy_used_kwh" fill="#e82127" radius={[4, 4, 0, 0]} />
                <Line yAxisId="battery" dataKey="end_battery_level" name="行程结束电量 (%)" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="energy-history-note">按行程结束时间排列；电量消耗来自行程起止的 LifetimeEnergyUsed 差值。</p>
          </div>
        )
      ) : chargeData.length === 0 ? (
        <div className="energy-history-empty">
          近 90 天没有充电会话记录；收到充电遥测后会显示每次充电量和峰值功率。
        </div>
      ) : (
        <div className="energy-history-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chargeDailyData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#858991" }} />
              <YAxis yAxisId="energy" unit=" kWh" tick={{ fontSize: 10, fill: "#858991" }} />
              <YAxis yAxisId="power" orientation="right" unit=" kW" tick={{ fontSize: 10, fill: "#858991" }} />
              <Tooltip
                labelFormatter={(value) => `充电日期：${value}`}
                formatter={(value, name) => [
                  value == null ? "—" : Number(value).toFixed(1),
                  name === "daily_energy_kwh" ? "当日充入电量 (kWh)" : "当日最高功率 (kW)",
                ]}
              />
              <Bar yAxisId="energy" dataKey="daily_energy_kwh" name="daily_energy_kwh" fill="#e82127" radius={[4, 4, 0, 0]} />
              <Line yAxisId="power" dataKey="max_power_kw" name="max_power_kw" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Legend formatter={(value) => value === "daily_energy_kwh" ? "当日充入电量" : "当日最高功率"} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="energy-history-note">按自然日汇总；柱形为当日充入电量，曲线为当日最高充电功率。下方可选择单次充电查看电量与功率变化。</p>
          <div className="charge-session-detail">
            <div className="charge-session-detail-heading">
              <div>
                <strong>单次充电变化</strong>
                <span>查看所选会话的电量与充电功率</span>
              </div>
              <select
                aria-label="选择充电会话"
                value={selectedChargeSessionId}
                onChange={(event) => setSelectedChargeSessionId(event.target.value)}
              >
                {chargeData.map((session) => (
                  <option key={session.id} value={session.id}>
                    {dateTime.format(new Date(session.started_at))}
                    {session.charging_type ? ` · ${session.charging_type}` : ""}
                  </option>
                ))}
              </select>
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
                        tickFormatter={(value) =>
                          new Intl.DateTimeFormat("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(value))
                        }
                        minTickGap={28}
                        tick={{ fontSize: 10, fill: "#858991" }}
                      />
                      <YAxis yAxisId="battery" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: "#858991" }} />
                      <YAxis yAxisId="power" orientation="right" unit=" kW" tick={{ fontSize: 10, fill: "#858991" }} />
                      <Tooltip
                        labelFormatter={(value) => dateTime.format(new Date(value))}
                        formatter={(value, name) => [
                          value == null ? "—" : Number(value).toFixed(1),
                          name === "battery" ? "电池电量 (%)" : "充电功率 (kW)",
                        ]}
                      />
                      <Line yAxisId="battery" type="monotone" dataKey="battery" name="battery" stroke="#e82127" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                      <Line yAxisId="power" type="monotone" dataKey="power" name="power" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="energy-chart-legend">
                  <span><i className="legend-battery" />电池电量</span>
                  <span><i className="legend-soc" />充电功率</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
