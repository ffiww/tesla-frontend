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
type HistoryResponse = {
  success: boolean;
  battery?: { BatteryLevel?: Point[]; Soc?: Point[] };
  drives?: Drive[];
  charging_sessions?: ChargingSession[];
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
            <ComposedChart data={chargeData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eceef0" strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#858991" }} />
              <YAxis yAxisId="energy" unit=" kWh" tick={{ fontSize: 10, fill: "#858991" }} />
              <YAxis yAxisId="power" orientation="right" unit=" kW" tick={{ fontSize: 10, fill: "#858991" }} />
              <Tooltip
                labelFormatter={(value) => `充电日期：${value}`}
                formatter={(value, name) => [
                  value == null ? "—" : Number(value).toFixed(1),
                  name === "energy_added_kwh" ? "充入电量 (kWh)" : "峰值功率 (kW)",
                ]}
              />
              <Bar yAxisId="energy" dataKey="energy_added_kwh" name="energy_added_kwh" fill="#e82127" radius={[4, 4, 0, 0]} />
              <Line yAxisId="power" dataKey="max_power_kw" name="max_power_kw" stroke="#3186c8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="energy-history-note">按充电开始时间排列；显示每次充入电量和峰值功率。</p>
        </div>
      )}
    </article>
  );
}
