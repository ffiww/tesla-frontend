import {
  NextRequest,
  NextResponse,
} from "next/server";

import crypto from "crypto";

/*
 * 验证 Dashboard Session。
 *
 * 签名规则与 vehicle-status / wake-up
 * 保持完全一致。
 */
function isValidDashboardSession(
  sessionValue: string | undefined
) {
  const secret =
    process.env.DASHBOARD_SESSION_SECRET;

  if (!secret || !sessionValue) {
    return false;
  }

  const [expiresAtString, signature] =
    sessionValue.split(".");

  if (
    !expiresAtString ||
    !signature
  ) {
    return false;
  }

  const expiresAt =
    Number(expiresAtString);

  if (
    !Number.isFinite(expiresAt) ||
    Date.now() >= expiresAt
  ) {
    return false;
  }

  const payload =
    `tesla-dashboard:${expiresAtString}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("hex");

  if (
    signature.length !==
    expectedSignature.length
  ) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(
        signature,
        "utf8"
      ),
      Buffer.from(
        expectedSignature,
        "utf8"
      )
    );
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest
) {
  /*
   * 第一层：
   * 只有已经通过 Tesla 登录的浏览器
   * 才能访问这个诊断接口。
   */
  const session =
    request.cookies.get(
      "tesla_dashboard_session"
    )?.value;

  if (
    !isValidDashboardSession(
      session
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        authenticated: false,
        error: "Unauthorized",
      },
      {
        status: 401,
      }
    );
  }

  /*
   * 第二层：
   * INTERNAL_API_SECRET
   * 只在 Vercel Server 内部使用。
   */
  const internalApiSecret =
    process.env.INTERNAL_API_SECRET;

  if (!internalApiSecret) {
    console.error(
      "INTERNAL_API_SECRET is not configured"
    );

    return NextResponse.json(
      {
        success: false,
        authenticated: true,
        error:
          "Server configuration error",
      },
      {
        status: 500,
      }
    );
  }

  try {
    /*
     * 注意：
     * 这里调用的是 fleet-status。
     *
     * 不要改成 vehicle-status。
     */
    const response = await fetch(
      "https://api.ffiww.com/api/tesla/fleet-status",
      {
        method: "GET",

        headers: {
          "x-internal-api-secret":
            internalApiSecret,
        },

        cache: "no-store",
      }
    );

    const data =
      await response.json();

    return NextResponse.json(
      {
        ...data,
        authenticated: true,
      },
      {
        status:
          response.status,
      }
    );
  } catch (error) {
    console.error(
      "Tesla fleet-status proxy error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        authenticated: true,
        error:
          "Fleet Status 查询失败，请稍后重试。",
      },
      {
        status: 502,
      }
    );
  }
}
