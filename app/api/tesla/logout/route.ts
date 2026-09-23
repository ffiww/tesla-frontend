import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({
    success: true,
  });

  response.cookies.set({
    name: "tesla_dashboard_session",
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: ".ffiww.com",
    path: "/",
    maxAge: 0,
  });

  return response;
}
