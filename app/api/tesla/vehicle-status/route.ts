import { NextResponse } from "next/server";

export async function GET() {
  try {
    const internalApiSecret = process.env.INTERNAL_API_SECRET;

    if (!internalApiSecret) {
      console.error("INTERNAL_API_SECRET is not configured");

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
          "x-internal-api-secret": internalApiSecret,
        },
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          connected: false,
          error: data?.error || "读取 Tesla 数据失败",
        },
        { status: response.status },
      );
    }

    const vehicle = data?.vehicle;

    if (!vehicle) {
      return NextResponse.json(
        {
          connected: false,
          error: "Tesla 账户下没有可访问的车辆。",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      connected: data?.connected ?? true,
      vehicle,
      snapshot: data?.snapshot ?? null,
      history: [],
      sleeping: Boolean(data?.sleeping),
      realtimeUnavailable: Boolean(data?.realtimeUnavailable),
    });
  } catch (error) {
    console.error("Tesla vehicle-status proxy error:", error);

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
