import {
  NextRequest,
  NextResponse,
} from "next/server";

import crypto from "crypto";

/*
 * 验证 Dashboard Session。
 *
 * Session 由 api.ffiww.com 的 Tesla OAuth callback
 * 登录成功后签发。
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
   * 必须拥有有效 Dashboard Session。
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
        connected: false,
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
   * frontend server 使用
   * INTERNAL_API_SECRET
   * 调用真正的 Tesla backend。
   *
   * Secret 不会暴露给浏览器。
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
        connected: false,
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
     * 这里必须调用 vehicle-status，
     * 不能调用 fleet-status。
     */
    const response = await fetch(
      "https://api.ffiww.com/api/tesla/vehicle-status",
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

    /*
     * 登录已经通过，因此在返回给 Dashboard
     * 的数据中明确标记 authenticated = true。
     */
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
      "Tesla vehicle-status proxy error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        connected: false,
        authenticated: true,
        error:
          "车辆状态查询失败，请稍后重试。",
      },
      {
        status: 502,
      }
    );
  }
}
