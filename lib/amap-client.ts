"use client";

export type Coordinate = [number, number];

export type AMapLocation = {
  getLng?: () => number;
  getLat?: () => number;
  lng?: number;
  lat?: number;
};

export type AMapApi = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => {
    add: (overlays: unknown | unknown[]) => void;
    setFitView: (overlays?: unknown[], immediately?: boolean, padding?: number[]) => void;
    destroy: () => void;
  };
  Polyline: new (options: Record<string, unknown>) => unknown;
  Marker: new (options: Record<string, unknown>) => unknown;
  convertFrom: (
    points: Coordinate[],
    source: "gps",
    callback: (status: string, result: {
      info?: string;
      infocode?: string;
      locations?: AMapLocation[];
    }) => void
  ) => void;
  plugin: (name: string, callback: () => void) => void;
  Geocoder: new (options: Record<string, unknown>) => {
    getAddress: (
      point: Coordinate,
      callback: (status: string, result: any) => void
    ) => void;
  };
};

declare global {
  interface Window {
    AMap?: AMapApi;
    _AMapSecurityConfig?: { serviceHost: string };
    __teslaAmapScriptPromise?: Promise<AMapApi>;
  }
}

const SDK_SCRIPT_ID = "amap-js-sdk";
const CONVERSION_BATCH_SIZE = 40;
const CONVERSION_RETRIES = 2;
const CONVERSION_TIMEOUT_MS = 10_000;
const GEOCODER_TIMEOUT_MS = 10_000;

function configureServiceProxy() {
  window._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/api/tesla/energy-history/_AMapService`,
  };
}

export function loadAMap(): Promise<AMapApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("高德地图只能在浏览器中加载"));
  }

  // Both dashboard maps must share the same service proxy configuration and SDK promise.
  configureServiceProxy();
  if (window.AMap) return Promise.resolve(window.AMap);
  if (window.__teslaAmapScriptPromise) return window.__teslaAmapScriptPromise;

  const key = process.env.NEXT_PUBLIC_AMAP_KEY;
  if (!key) return Promise.reject(new Error("尚未配置高德地图 Web JS API Key"));

  window.__teslaAmapScriptPromise = new Promise<AMapApi>((resolve, reject) => {
    const existing = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error("高德地图 SDK 加载超时")),
      15_000
    );

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (error) {
        if (!existing) script.remove();
        window.__teslaAmapScriptPromise = undefined;
        reject(error);
      } else if (window.AMap) {
        resolve(window.AMap);
      } else {
        window.__teslaAmapScriptPromise = undefined;
        reject(new Error("高德地图脚本已加载，但 SDK 不可用"));
      }
    };

    const onLoad = () => finish();
    const onError = () => finish(new Error("高德地图加载失败，请检查 Key 和域名白名单"));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = SDK_SCRIPT_ID;
      script.async = true;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      document.head.appendChild(script);
    }
  });

  return window.__teslaAmapScriptPromise;
}

function locationTuple(location: AMapLocation): Coordinate | null {
  const longitude =
    typeof location.getLng === "function" ? location.getLng() : location.lng;
  const latitude =
    typeof location.getLat === "function" ? location.getLat() : location.lat;
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude as number, latitude as number]
    : null;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function convertGpsBatch(
  AMap: AMapApi,
  batch: Coordinate[]
): Promise<AMapLocation[]> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const request = () => {
      let settled = false;
      let timeout = 0;

      const retryOrReject = (reason: string) => {
        window.clearTimeout(timeout);
        if (attempt < CONVERSION_RETRIES) {
          const delay = 400 * 2 ** attempt;
          attempt += 1;
          void wait(delay).then(request);
          return;
        }
        reject(new Error(`高德 GPS 坐标转换失败（${reason}）`));
      };

      timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        retryOrReject("请求超时");
      }, CONVERSION_TIMEOUT_MS);

      try {
        AMap.convertFrom(batch, "gps", (status, result) => {
          if (settled) return;
          settled = true;
          const locations = result?.locations ?? [];
          const validLocations = locations.length === batch.length &&
            locations.every((location) => locationTuple(location) !== null);

          if (
            status === "complete" &&
            result?.info === "ok" &&
            validLocations
          ) {
            window.clearTimeout(timeout);
            resolve(locations);
            return;
          }

          const details = [status, result?.info, result?.infocode]
            .filter(Boolean)
            .join(" / ") || "未返回错误详情";
          retryOrReject(details);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        retryOrReject(error instanceof Error ? error.message : "请求异常");
      }
    };

    request();
  });
}

/**
 * Convert WGS-84/GPS coordinates returned by Tesla into AMap's GCJ-02 coordinates.
 * Batches are deliberately sent serially: parallel batches can make an otherwise
 * healthy single-point conversion work while a long trip route fails intermittently.
 */
export async function convertGpsPoints(
  AMap: AMapApi,
  coordinates: Coordinate[]
): Promise<AMapLocation[]> {
  if (coordinates.some(([longitude, latitude]) =>
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )) {
    throw new Error("行程中包含无效 GPS 坐标");
  }

  const converted: AMapLocation[] = [];
  for (let index = 0; index < coordinates.length; index += CONVERSION_BATCH_SIZE) {
    const batch = coordinates.slice(index, index + CONVERSION_BATCH_SIZE);
    converted.push(...await convertGpsBatch(AMap, batch));
  }
  return converted;
}

export type ReverseGeocodeResult = {
  name: string | null;
  formattedAddress: string | null;
};

export function reverseGeocode(
  AMap: AMapApi,
  coordinates: Coordinate
): Promise<ReverseGeocodeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (result: ReverseGeocodeResult) => {
      if (settled) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      resolve(result);
    };

    timeout = window.setTimeout(
      () => finish({ name: null, formattedAddress: null }),
      GEOCODER_TIMEOUT_MS
    );

    try {
      AMap.plugin("AMap.Geocoder", () => {
        try {
          const geocoder = new AMap.Geocoder({ radius: 1000, extensions: "all" });
          geocoder.getAddress(coordinates, (status, result) => {
            const regeo = result?.regeocode;
            if (String(status).toLowerCase() !== "complete" || !regeo) {
              finish({ name: null, formattedAddress: null });
              return;
            }

            const firstPoi = Array.isArray(regeo.pois) ? regeo.pois[0] : null;
            finish({
              name: firstPoi?.name ?? firstPoi?.title ?? null,
              formattedAddress:
                regeo.formattedAddress ??
                regeo.formatted_address ??
                regeo.address ??
                null,
            });
          });
        } catch {
          finish({ name: null, formattedAddress: null });
        }
      });
    } catch {
      finish({ name: null, formattedAddress: null });
    }
  });
}
