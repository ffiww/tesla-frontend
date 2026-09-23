import {
  NextRequest,
  NextResponse,
} from "next/server";

import crypto from "crypto";

/*
 * 验证 Dashboard Session。
 * 必须与 vehicle-status/route.ts
 * 使用完全相同的签名规则。
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

  /*
   * timingSafeEqual 要求两边长度一致，
   * 所以先检查长度。
   */
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

export async function POST(
  request: NextRequest
) {
  /*
   * 第一层：
   * 浏览器必须拥有有效的
   * tesla_dashboard_session。
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
        ok: false,
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
   * frontend server 调用 backend 时
   * 必须携带 INTERNAL_API_SECRET。
   *
   * 这个 Secret 只存在服务器端，
   * 不会发送给浏览器。
   */
  const internalApiSecret =
    process.env.INTERNAL_API_SECRET;

  if (!internalApiSecret) {
    console.error(
      "INTERNAL_API_SECRET is not configured"
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          "Server configuration error",
      },
      {
        status: 500,
      }
    );
  }

  try {
    const response = await fetch(
      "https://api.ffiww.com/api/tesla/wake-up",
      {
        method: "POST",

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
     * 尽量保留 backend 返回的信息，
     * 方便前端判断 Tesla 是否接受了唤醒请求。
     */
    return NextResponse.json(
      {
        ok: response.ok,
        authenticated: true,

        alreadyOnline:
          data?.alreadyOnline ??
          false,

        vehicle:
          data?.vehicle,

        error:
          data?.error,
      },
      {
        status:
          response.status,
      }
    );
  } catch (error) {
    console.error(
      "Tesla wake-up proxy error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        authenticated: true,
        error:
          "唤醒请求失败，请稍后重试。",
      },
      {
        status: 502,
      }
    );
  }
}
