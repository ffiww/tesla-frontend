import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

function secret() {
  return process.env.DASHBOARD_SESSION_SECRET;
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
  } catch {
    return false;
  }
}

function signature(payload: string) {
  const key = secret();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

function validDashboardSession(value: string | undefined) {
  if (!value || !secret()) return false;
  const [expiresAt, providedSignature] = value.split(".");
  const expiry = Number(expiresAt);
  if (!expiresAt || !providedSignature || !Number.isFinite(expiry) || Date.now() >= expiry) return false;
  const expected = signature(`tesla-dashboard:${expiresAt}`);
  return Boolean(expected && safeEqual(providedSignature, expected));
}

function issueMiniToken() {
  const expiresAt = String(Date.now() + TOKEN_LIFETIME_MS);
  const tokenSignature = signature(`tesla-miniprogram:${expiresAt}`);
  return tokenSignature ? `${expiresAt}.${tokenSignature}` : null;
}

function validMiniToken(value: string | null) {
  if (!value || !secret()) return false;
  const [expiresAt, providedSignature] = value.split(".");
  const expiry = Number(expiresAt);
  if (!expiresAt || !providedSignature || !Number.isFinite(expiry) || Date.now() >= expiry) return false;
  if (expiry > Date.now() + TOKEN_LIFETIME_MS + 60_000) return false;
  const expected = signature(`tesla-miniprogram:${expiresAt}`);
  return Boolean(expected && safeEqual(providedSignature, expected));
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

function unauthorized() {
  return json({ success: false, authenticated: false, error: "连接已过期，请重新从车况网页获取令牌" }, 401);
}

export async function handleMiniProgramProxy(request: NextRequest, path: string[]) {
  if (path.length === 1 && path[0] === "session") {
    if (request.method !== "GET") return json({ success: false, error: "Method Not Allowed" }, 405);
    const session = request.cookies.get("tesla_dashboard_session")?.value;
    if (!validDashboardSession(session)) {
      return json({ success: false, error: "请先在网页登录 Tesla 车况" }, 401);
    }
    const token = issueMiniToken();
    if (!token) return json({ success: false, error: "服务端尚未配置登录签名" }, 503);
    return json({ success: true, token, expires_in: TOKEN_LIFETIME_MS / 1000 });
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!validMiniToken(bearer)) return unauthorized();

  if (path.length === 1 && path[0] === "location-name" && request.method === "GET") {
    const location = request.nextUrl.searchParams.get("location") || "";
    if (!/^-?\d{1,3}(?:\.\d{1,8})?,-?\d{1,2}(?:\.\d{1,8})?$/.test(location)) {
      return json({ success: false, error: "Invalid location" }, 400);
    }
    const key = process.env.NEXT_PUBLIC_AMAP_KEY;
    const securityCode = process.env.AMAP_SECURITY_JS_CODE;
    if (!key || !securityCode) return json({ success: false, error: "Map service is not configured" }, 503);
    try {
      const target = new URL("https://restapi.amap.com/v3/geocode/regeo");
      target.searchParams.set("key", key);
      target.searchParams.set("jscode", securityCode);
      target.searchParams.set("location", location);
      target.searchParams.set("extensions", "all");
      target.searchParams.set("output", "JSON");
      const response = await fetch(target, {
        headers: { Referer: "https://tesla.ffiww.com/" },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || result?.status !== "1") {
        return json({ success: false, error: "位置名称解析暂不可用" }, 502);
      }
      const regeo = result.regeocode || {};
      const poi = Array.isArray(regeo.pois) ? regeo.pois[0] : null;
      return json({ success: true, name: poi?.name || null, formattedAddress: regeo.formatted_address || null });
    } catch (error) {
      console.error("Tesla mini-program reverse-geocode error:", error);
      return json({ success: false, error: "位置名称解析暂不可用" }, 502);
    }
  }

  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!internalSecret) return json({ success: false, error: "Server configuration error" }, 500);

  const query = request.nextUrl.searchParams;
  let target: URL;
  let method: "GET" | "POST" = "GET";

  if (path.length === 1 && path[0] === "vehicle-status" && request.method === "GET") {
    target = new URL("https://api.ffiww.com/api/tesla/vehicle-status");
  } else if (path.length === 1 && path[0] === "drive-history" && request.method === "GET") {
    target = new URL("https://api.ffiww.com/api/tesla/drive-history");
    for (const key of ["drive_id", "before"]) {
      const value = query.get(key);
      if (value && value.length < 100) target.searchParams.set(key, value);
    }
  } else if (path.length === 1 && path[0] === "energy-history" && request.method === "GET") {
    target = new URL("https://api.ffiww.com/api/tesla/drive-history");
    target.searchParams.set("view", "energy");
    for (const key of ["from", "to", "all"]) {
      const value = query.get(key);
      if (value && value.length < 32) target.searchParams.set(key, value);
    }
  } else if (path.length === 1 && path[0] === "wake-up" && request.method === "POST") {
    target = new URL("https://api.ffiww.com/api/tesla/wake-up");
    method = "POST";
  } else {
    return json({ success: false, error: "Unsupported mini-program endpoint" }, 404);
  }

  try {
    const response = await fetch(target, {
      method,
      headers: { "x-internal-api-secret": internalSecret },
      cache: "no-store",
    });
    const body = await response.json();
    return json({ ...body, authenticated: true }, response.status);
  } catch (error) {
    console.error("Tesla mini-program API proxy error:", error);
    return json({ success: false, authenticated: true, error: "Tesla 服务暂时不可用，请稍后重试" }, 502);
  }
}

