import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function isValidDashboardSession(
  sessionValue: string | undefined,
): boolean {
  if (!sessionValue) {
    return false;
  }

  const secret = process.env.DASHBOARD_SESSION_SECRET;

  if (!secret) {
    console.error(
      "DASHBOARD_SESSION_SECRET is not configured",
    );
    return false;
  }

  const separatorIndex = sessionValue.indexOf(".");

  if (separatorIndex === -1) {
    return false;
  }

  const expiresAtString = sessionValue.slice(
    0,
    separatorIndex,
  );

  const providedSignature = sessionValue.slice(
    separatorIndex + 1,
  );

  const expiresAt = Number(expiresAtString);

  if (
    !Number.isFinite(expiresAt) ||
    Date.now() >= expiresAt
  ) {
    return false;
  }

  const payload =
    `tesla-dashboard:${expiresAtString}`;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  try {
    const providedBuffer = Buffer.from(
      providedSignature,
      "hex",
    );

    const expectedBuffer = Buffer.from(
      expectedSignature,
      "hex",
    );

    if (
      providedBuffer.length !== expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      providedBuffer,
      expectedBuffer,
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    // 1. 检查当前浏览器是否已经通过 Tesla 登录
    const sessionValue =
      request.cookies.get(
        "tesla_dashboard_session",
      )?.value;

    if (!isValidDashboardSession(sessionValue)) {
      return NextResponse.json(
        {
          connected: false,
          authenticated: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    // 2. Session 合法后，才允许服务器访问 Tesla 后端
    const internalApiSecret =
      process.env.INTERNAL_API_SECRET;

    if (!internalApiSecret) {
      console.error(
        "INTERNAL_API_SECRET is not configured",
      );

      return NextResponse.json(
        {
          connected: false,
          error: "服务器配置错误",
        },
        { status: 500 },
      );
    }

    const response = await fetch(
      "https://api.ffiww.com/api/tesla/vehicle-status",
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-internal-api-secret":
            internalApiSecret,
        },
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          connected: false,
          error:
            data?.error ||
            "读取 Tesla 数据失败",
        },
        { status: response.status },
      );
    }

    const vehicle = data?.vehicle;

    if (!vehicle) {
      return NextResponse.json(
        {
          connected: false,
          error:
            "Tesla 账户下没有可访问的车辆。",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      connected: data?.connected ?? true,
      authenticated: true,
      vehicle,
      snapshot: data?.snapshot ?? null,
      history: [],
      sleeping: Boolean(data?.sleeping),
      realtimeUnavailable: Boolean(
        data?.realtimeUnavailable,
      ),
    });

  } catch (error) {
    console.error(
      "Tesla vehicle-status proxy error:",
      error,
    );

    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "读取 Tesla 数据失败",
      },
      { status: 502 },
    );
  }
}
