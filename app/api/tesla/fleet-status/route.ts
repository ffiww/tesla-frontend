import { neon } from "@neondatabase/serverless";

const TESLA_AUTH_URL =
  "https://auth.tesla.cn/oauth2/v3/token";

const TESLA_API =
  "https://fleet-api.prd.cn.vn.cloud.tesla.cn";

async function refreshTeslaToken(
  sql,
  refreshToken
) {
  const response = await fetch(
    TESLA_AUTH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id:
          process.env.TESLA_CLIENT_ID,
        refresh_token: refreshToken
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Tesla token refresh failed: ${
        data.error || response.status
      }`
    );
  }

  const expiresAt =
    Date.now() +
    Number(data.expires_in) * 1000;

  await sql`
    UPDATE tesla_tokens
    SET
      access_token = ${data.access_token},
      refresh_token = ${data.refresh_token},
      expires_at = ${expiresAt},
      updated_at = NOW()
    WHERE id = 1
  `;

  return data.access_token;
}

export default async function handler(
  req,
  res
) {
  /*
   * 这个接口仅用于内部诊断。
   * 浏览器不能直接调用。
   */
  const providedSecret =
    req.headers["x-internal-api-secret"];

  if (
    !process.env.INTERNAL_API_SECRET ||
    providedSecret !==
      process.env.INTERNAL_API_SECRET
  ) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  try {
    const sql = neon(
      process.env.DATABASE_URL
    );

    /*
     * 读取 Tesla Token
     */
    const rows = await sql`
      SELECT
        access_token,
        refresh_token,
        expires_at
      FROM tesla_tokens
      WHERE id = 1
    `;

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error:
          "Tesla account not connected"
      });
    }

    let {
      access_token,
      refresh_token,
      expires_at
    } = rows[0];

    /*
     * Token 即将过期则自动刷新。
     */
    if (
      Date.now() >=
      Number(expires_at) - 60 * 1000
    ) {
      access_token =
        await refreshTeslaToken(
          sql,
          refresh_token
        );
    }

    /*
     * Tesla 官方 fleet_status：
     *
     * POST /api/1/vehicles/fleet_status
     *
     * 注意：
     * 这里必须是 POST，不是 GET。
     */
    const response = await fetch(
      `${TESLA_API}/api/1/vehicles/fleet_status`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${access_token}`,
          "Content-Type":
            "application/json"
        }
      }
    );

    /*
     * Tesla 正常情况下返回 JSON。
     * 这里先读取 text，再尝试解析，
     * 可以避免异常响应导致二次报错。
     */
    const responseText =
      await response.text();

    let data;

    try {
      data =
        responseText
          ? JSON.parse(responseText)
          : null;
    } catch {
      data = {
        rawResponse:
          responseText
      };
    }

    if (!response.ok) {
      return res
        .status(response.status)
        .json({
          success: false,
          status: response.status,
          error: data
        });
    }

    /*
     * 只返回 Fleet Status。
     *
     * 不返回：
     * - Access Token
     * - Refresh Token
     * - INTERNAL_API_SECRET
     * - DATABASE_URL
     */
    return res.status(200).json({
      success: true,
      fleetStatus: data
    });

  } catch (error) {
    console.error(
      "Tesla fleet-status error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error"
    });
  }
}
