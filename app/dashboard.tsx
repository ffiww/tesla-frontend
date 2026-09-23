"use client";

import {
  BatteryCharging,
  CarFront,
  ChevronRight,
  Clock3,
  Gauge,
  LoaderCircle,
  LocateFixed,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Route,
  Thermometer,
  Unplug,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type Snapshot = {
  capturedAt: string;
  batteryLevel: number | null;
  batteryRangeKm: number | null;
  chargingState: string | null;
  chargeRateKmH: number | null;
  minutesToFullCharge: number | null;
  odometerKm: number | null;
  insideTempC: number | null;
  outsideTempC: number | null;
  locked: boolean | null;
  latitude: number | null;
  longitude: number | null;
};

type VehiclePayload = {
  connected: boolean;
  authenticated?: boolean;
  vehicle?: {
    id: string;
    name: string;
    state: string;
  };
  snapshot?: Snapshot;
  history?: Snapshot[];
  missingConfig?: string[];
  error?: string;
  sleeping?: boolean;
};

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const display = (
  v: number | null | undefined,
  suffix = ""
) => (v == null ? "—" : `${Math.round(v)}${suffix}`);

function Sparkline({
  history,
}: {
  history: Snapshot[];
}) {
  const points = history
    .filter((item) => item.batteryLevel != null)
    .slice(-12);

  if (points.length < 2) {
    return (
      <div className="empty-chart">
        <Route size={22} />
        <span>首次刷新后开始记录电量趋势</span>
      </div>
    );
  }

  const path = points
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"} ${
          (index / (points.length - 1)) * 100
        } ${
          62 -
          ((item.batteryLevel ?? 0) / 100) * 52
        }`
    )
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 68"
      preserveAspectRatio="none"
      aria-label="近期电量趋势"
    >
      <defs>
        <linearGradient
          id="chargeFill"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#e82127"
            stopOpacity=".25"
          />
          <stop
            offset="100%"
            stopColor="#e82127"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      <path
        d={`${path} L 100 68 L 0 68 Z`}
        fill="url(#chargeFill)"
      />

      <path
        d={path}
        fill="none"
        stroke="#e82127"
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function Dashboard({
  signedIn,
  email,
}: {
  signedIn: boolean;
  email: string | null;
}) {
  const [data, setData] =
    useState<VehiclePayload | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [waking, setWaking] =
    useState(false);

  const [wakeError, setWakeError] =
    useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(
        "/api/tesla/vehicle-status",
        {
          cache: "no-store",
        }
      );

      setData(await response.json());
    } catch {
      setData({
        connected: false,
        error:
          "暂时无法连接服务器，请稍后重试。",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * 退出 Dashboard 登录
   */
  const logout = useCallback(async () => {
    setLoggingOut(true);

    try {
      const response = await fetch(
        "/api/tesla/logout",
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error("退出失败");
      }

      /*
       * 重新加载整个页面。
       * 下一次 vehicle-status 请求已经没有 Session，
       * 因此会返回 401，不再显示车辆数据。
       */
      window.location.reload();
    } catch {
      setLoggingOut(false);
      window.alert(
        "退出登录失败，请稍后重试。"
      );
    }
  }, []);

  const wakeUp = useCallback(async () => {
    setWaking(true);
    setWakeError(null);

    try {
      const response = await fetch(
        "/api/tesla/wake-up",
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error(
          "唤醒请求失败，请稍后重试。"
        );
      }

      const deadline =
        Date.now() + 60000;

      while (Date.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, 5000)
        );

        const status = await fetch(
          "/api/tesla/vehicle-status",
          {
            cache: "no-store",
          }
        );

        const next =
          (await status.json()) as VehiclePayload;

        setData(next);

        if (
          next.vehicle?.state === "online" &&
          next.snapshot
        ) {
          return;
        }
      }

      setWakeError(
        "车辆暂未上线，请稍后重试"
      );
    } catch (error) {
      setWakeError(
        error instanceof Error
          ? error.message
          : "唤醒请求失败，请稍后重试。"
      );
    } finally {
      setWaking(false);
    }
  }, []);

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool?: Function;
        };
      }
    ).modelContext;

    if (!modelContext?.registerTool) {
      return;
    }

    const controller =
      new AbortController();

    void Promise.resolve(
      modelContext.registerTool(
        {
          name: "refresh_tesla_status",
          title: "刷新 Tesla 车况",
          description:
            "读取当前已授权车辆的最新只读状态，并更新页面。",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: false,
          },
          execute: async () => {
            await load();

            return {
              refreshed: true,
            };
          },
        },
        {
          signal: controller.signal,
        }
      )
    ).catch(() => undefined);

    return () =>
      controller.abort();
  }, [load]);

  const snapshot = data?.snapshot;

  const chargeLabel = useMemo(
    () =>
      (
        {
          Charging: "正在充电",
          Complete: "充电完成",
          Disconnected: "未连接充电器",
          NoPower: "已连接 · 无电流",
          Stopped: "充电已停止",
        } as Record<string, string>
      )[snapshot?.chargingState ?? ""] ??
      snapshot?.chargingState ??
      "状态未知",
    [snapshot?.chargingState]
  );

  const connected =
    Boolean(data?.connected);

  /*
   * authenticated 来自我们自己的
   * vehicle-status Session 校验。
   *
   * 不再使用 page.tsx 里原来的 signedIn
   * 作为真实登录判断。
   */
  const authenticated =
    data?.authenticated === true;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#top"
          aria-label="Tesla 车况首页"
        >
          <span className="brand-mark">
            T
          </span>
          <span>TESLA 车况</span>
        </a>

        <div className="header-status">
          <span
            className={
              connected
                ? "status-dot online"
                : "status-dot"
            }
          />

          <span>
            {connected
              ? "车辆已连接"
              : authenticated
                ? "车辆未连接"
                : "等待连接"}
          </span>

          {email && (
            <span className="account-pill">
              {email}
            </span>
          )}

          {authenticated && (
            <button
              type="button"
              onClick={() => void logout()}
              disabled={loggingOut}
              title="退出登录"
              aria-label="退出登录"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                border: "none",
                background: "transparent",
                cursor: loggingOut
                  ? "default"
                  : "pointer",
                opacity: loggingOut
                  ? 0.6
                  : 1,
                font: "inherit",
              }}
            >
              {loggingOut ? (
                <LoaderCircle
                  className="spin"
                  size={16}
                />
              ) : (
                <LogOut size={16} />
              )}

              <span>
                {loggingOut
                  ? "正在退出"
                  : "退出登录"}
              </span>
            </button>
          )}
        </div>
      </header>

      <section
        className="dashboard"
        id="top"
      >
        <div className="vehicle-heading">
          <div>
            <p className="eyebrow">
              个人车辆
            </p>

            <h1>
              {data?.vehicle?.name ??
                "我的 Tesla"}
            </h1>

            <p className="vehicle-meta">
              <span>
                {data?.vehicle?.state ===
                "online"
                  ? "在线"
                  : data?.vehicle?.state ??
                    "尚未授权"}
              </span>

              <span>·</span>

              <span>
                {snapshot?.capturedAt
                  ? `更新于 ${formatter.format(
                      new Date(
                        snapshot.capturedAt
                      )
                    )}`
                  : "等待首次同步"}
              </span>
            </p>
          </div>

          <button
            className="refresh-button"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle
                className="spin"
                size={18}
              />
            ) : (
              <RefreshCw size={18} />
            )}

            {loading
              ? "正在读取"
              : "刷新车况"}
          </button>
        </div>

        {!loading &&
          !connected &&
          data?.sleeping && (
            <section
              className="setup-panel"
              aria-live="polite"
            >
              <div className="setup-icon">
                <CarFront size={28} />
              </div>

              <div className="setup-copy">
                <p className="eyebrow">
                  车辆休眠
                </p>

                <h2>
                  车辆当前处于休眠状态
                </h2>

                <p>
                  {waking
                    ? "正在唤醒车辆…"
                    : wakeError ??
                      "手动唤醒后将自动等待车辆上线。"}
                </p>

                <button
                  className="connect-button"
                  onClick={() =>
                    void wakeUp()
                  }
                  disabled={waking}
                >
                  {waking ? (
                    <LoaderCircle
                      className="spin"
                      size={18}
                    />
                  ) : (
                    <Zap size={18} />
                  )}

                  {waking
                    ? "正在唤醒车辆…"
                    : "唤醒车辆"}
                </button>
              </div>

              <div className="privacy-note">
                <LockKeyhole size={16} />
                仅在你点击后发送唤醒请求
              </div>
            </section>
          )}

        {!loading &&
          !connected &&
          !data?.sleeping && (
            <section
              className="setup-panel"
              aria-live="polite"
            >
              <div className="setup-icon">
                <CarFront size={28} />
              </div>

              <div className="setup-copy">
                <p className="eyebrow">
                  开始使用
                </p>

                <h2>
                  {data?.missingConfig
                    ?.length
                    ? "还差一步：配置 Tesla 开发者凭证"
                    : "连接你的 Tesla"}
                </h2>

                <p>
                  {data?.error ===
                  "Unauthorized"
                    ? "登录 Tesla 账户后即可查看车辆状态。"
                    : data?.error ??
                      "使用 Tesla 官方授权后，这里会显示车辆实时状态。网站不会保存你的 Tesla 密码。"}
                </p>

                {data?.missingConfig
                  ?.length ? (
                  <div className="config-list">
                    {data.missingConfig.map(
                      (item) => (
                        <code key={item}>
                          {item}
                        </code>
                      )
                    )}
                  </div>
                ) : (
                  <a
                    className="connect-button"
                    href="/api/tesla/start"
                  >
                    使用 Tesla 账户连接
                    <ChevronRight
                      size={18}
                    />
                  </a>
                )}
              </div>

              <div className="privacy-note">
                <LockKeyhole size={16} />
                只申请车辆状态所需权限
              </div>
            </section>
          )}

        <section
          className={
            connected
              ? "hero-grid"
              : "hero-grid is-muted"
          }
          aria-label="车辆概览"
        >
          <article className="battery-card">
            <div className="card-title">
              <BatteryCharging
                size={18}
              />
              <span>电池</span>
            </div>

            <div className="battery-value">
              {display(
                snapshot?.batteryLevel,
                "%"
              )}
            </div>

            <div className="battery-track">
              <span
                style={{
                  width: `${
                    snapshot?.batteryLevel ??
                    0
                  }%`,
                }}
              />
            </div>

            <div className="range-row">
              <span>预计续航</span>
              <strong>
                {display(
                  snapshot?.batteryRangeKm,
                  " km"
                )}
              </strong>
            </div>
          </article>

          <article className="charge-card">
            <div className="charge-orb">
              <Zap size={28} />
            </div>

            <div>
              <p className="eyebrow">
                充电状态
              </p>
              <h2>
                {connected
                  ? chargeLabel
                  : "—"}
              </h2>
              <p>
                {snapshot?.minutesToFullCharge
                  ? `约 ${snapshot.minutesToFullCharge} 分钟充满`
                  : "暂无充电计划"}
              </p>
            </div>

            <div className="charge-rate">
              <span>
                {display(
                  snapshot?.chargeRateKmH,
                  " km/h"
                )}
              </span>
              <small>充电速度</small>
            </div>
          </article>
        </section>

        <section
          className={
            connected
              ? "metric-grid"
              : "metric-grid is-muted"
          }
          aria-label="详细车况"
        >
          <article className="metric">
            <Gauge />
            <span>总里程</span>
            <strong>
              {display(
                snapshot?.odometerKm,
                " km"
              )}
            </strong>
          </article>

          <article className="metric">
            <Thermometer />
            <span>车内 / 车外</span>
            <strong>
              {display(
                snapshot?.insideTempC,
                "°"
              )}{" "}
              /{" "}
              {display(
                snapshot?.outsideTempC,
                "°"
              )}
            </strong>
          </article>

          <article className="metric">
            <LockKeyhole />
            <span>车辆锁止</span>
            <strong>
              {snapshot?.locked == null
                ? "—"
                : snapshot.locked
                  ? "已锁车"
                  : "未锁车"}
            </strong>
          </article>

          <article className="metric">
            <LocateFixed />
            <span>车辆位置</span>
            <strong>
              {snapshot?.latitude == null
                ? "未授权"
                : "已获取"}
            </strong>
          </article>
        </section>

        <section className="lower-grid">
          <article className="trend-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  趋势
                </p>
                <h2>近期电量</h2>
              </div>

              <Clock3 size={20} />
            </div>

            <Sparkline
              history={
                data?.history ?? []
              }
            />

            <div className="chart-footer">
              <span>较早</span>
              <span>最近</span>
            </div>
          </article>

          <article className="facts-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  当前状态
                </p>
                <h2>快速检查</h2>
              </div>

              <Unplug size={20} />
            </div>

            <ul>
              <li>
                <span>车辆连接</span>
                <strong>
                  {data?.vehicle?.state ===
                  "online"
                    ? "在线"
                    : data?.vehicle
                        ?.state ?? "—"}
                </strong>
              </li>

              <li>
                <span>充电连接</span>
                <strong>
                  {snapshot?.chargingState ===
                  "Disconnected"
                    ? "未连接"
                    : chargeLabel}
                </strong>
              </li>

              <li>
                <span>数据时间</span>
                <strong>
                  {snapshot?.capturedAt
                    ? formatter.format(
                        new Date(
                          snapshot.capturedAt
                        )
                      )
                    : "—"}
                </strong>
              </li>
            </ul>
          </article>
        </section>
      </section>

      <footer>
        <span>
          数据来自 Tesla Fleet API
        </span>
        <span>
          仅限本人访问 · 令牌安全保存
        </span>
      </footer>
    </main>
  );
}
