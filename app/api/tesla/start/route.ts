import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.redirect("https://api.ffiww.com/api/tesla/login");
}
