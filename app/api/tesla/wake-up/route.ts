import { NextResponse } from "next/server";

export async function POST() {
  try {
    const response = await fetch("https://api.ffiww.com/api/tesla/wake-up", { method: "POST", cache: "no-store" });
    const data = await response.json();
    return NextResponse.json({ ok: response.ok, status: data?.status ?? (response.ok ? "wake_up_requested" : "failed"), error: data?.error }, { status: response.status });
  } catch (error) {
    console.error("Tesla wake-up proxy error:", error);
    return NextResponse.json({ ok: false, error: "唤醒请求失败，请稍后重试。" }, { status: 502 });
  }
}
