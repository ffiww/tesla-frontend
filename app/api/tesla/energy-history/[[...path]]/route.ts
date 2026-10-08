import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

type RouteContext = { params: Promise<{ path?: string[] }> };

function isValidDashboardSession(sessionValue: string | undefined) {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || !sessionValue) return false;

  const [expiresAtString, signature] = sessionValue.split(".");
  if (!expiresAtString || !signature) return false;

  const expiresAt = Number(expiresAtString);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`tesla-dashboard:${expiresAtString}`)
    .digest("hex");

  if (signature.length !== expectedSignature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json(
    { success: false, authenticated: false, error: "Unauthorized" },
    { status: 401 }
  );
}

async function proxyAMapService(request: NextRequest, path: string[]) {
  const securityCode = process.env.AMAP_SECURITY_JS_CODE;
  if (!securityCode) {
    return NextResponse.json(
      { success: false, error: "AMAP_SECURITY_JS_CODE is not configured" },
      { status: 503 }
    );
  }

  const servicePath = path[0] === "_AMapService" ? path.slice(1) : path;
  const joinedPath = servicePath.join("/");
  const isCustomStyle =
    /^v4\/map\/styles(?:\/[A-Za-z0-9_./-]+)?$/.test(joinedPath);
  const isWebService = /^v3\/[A-Za-z0-9_./-]+$/.test(joinedPath);

  if (!isCustomStyle && !isWebService) {
    return NextResponse.json(
      { success: false, error: "Unsupported AMap proxy path" },
      { status: 404 }
    );
  }
  if (joinedPath.includes("..")) {
    return NextResponse.json(
      { success: false, error: "Invalid AMap proxy path" },
      { status: 400 }
    );
  }

  const target = new URL(
    `/${joinedPath}`,
    isCustomStyle ? "https://webapi.amap.com" : "https://restapi.amap.com"
  );
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "jscode") target.searchParams.append(key, value);
  });
  target.searchParams.set("jscode", securityCode);

  let forwardedReferer = `${request.nextUrl.origin}/`;
  const incomingReferer = request.headers.get("referer");
  if (incomingReferer) {
    try {
      const refererUrl = new URL(incomingReferer);
      forwardedReferer =
        refererUrl.origin === request.nextUrl.origin
          ? `${refererUrl.origin}/`
          : "";
    } catch {
      forwardedReferer = "";
    }
  }

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: forwardedReferer ? { referer: forwardedReferer } : undefined,
      cache: "no-store",
      redirect: "manual",
    });
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");

    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("AMap service proxy error:", error);
    return NextResponse.json(
      { success: false, error: "AMap service request failed" },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const session = request.cookies.get("tesla_dashboard_session")?.value;
  if (!isValidDashboardSession(session)) return unauthorized();

  const { path } = await context.params;
  if (path?.length) {
    return proxyAMapService(request, path);
  }

  const internalApiSecret = process.env.INTERNAL_API_SECRET;
  if (!internalApiSecret) {
    console.error("INTERNAL_API_SECRET is not configured");
    return NextResponse.json(
      { success: false, authenticated: true, error: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://api.ffiww.com/api/tesla/drive-history?view=energy",
      {
        method: "GET",
        headers: { "x-internal-api-secret": internalApiSecret },
        cache: "no-store",
      }
    );
    const data = await response.json();
    return NextResponse.json(
      { ...data, authenticated: true },
      { status: response.status }
    );
  } catch (error) {
    console.error("Tesla energy-history proxy error:", error);
    return NextResponse.json(
      {
        success: false,
        authenticated: true,
        error: "历史能量数据读取失败，请稍后重试。",
      },
      { status: 502 }
    );
  }
}
