import {
  NextRequest,
  NextResponse,
} from "next/server";

import crypto from "crypto";

/*
 * 验证 Dashboard Session。
 *
 * 签名规则必须和我们现有的
 * vehicle-status / wake-up 保持一致。
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
   * 第一层安全检查：
   * 浏览器必须拥有有效的
   * Dashboard Session。
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
   * 只在 Vercel 服务器内部读取。
   *
   * 浏览器永远不会看到它。
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
     * 调用我们刚刚建立的
     * tesla-api fleet-status 接口。
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

    /*
     * 原样返回 Tesla API 的诊断结果。
     *
     * 后端接口本身不会返回
     * Tesla Access Token、
     * Refresh Token 或 Internal Secret。
     */
    return NextResponse.json(
      data,
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
