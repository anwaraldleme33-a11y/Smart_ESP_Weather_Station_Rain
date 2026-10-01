import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    const device = String(req.query.device || "");
    const lastId = Math.max(
      parseInt(req.query.lastId || "0", 10),
      0
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit || "5000", 10),
        1
      ),
      5000
    );

    if (!allowedDevices.includes(device)) {
      return res.status(400).json({
        success: false,
        error: "Invalid device"
      });
    }

    // العدد الكلي لسجلات المحطة في الأرشيف
    const countResult = await sql`
      SELECT COUNT(*)::int AS count
      FROM weather_archive
      WHERE device_id = ${device}
    `;

    const total =
      Number(countResult[0]?.count || 0);

    // جلب الأرشيف على دفعات باستخدام id
    const rows = await sql`
      SELECT
        id,
        device_id,
        temperture AS temperature,
        humidity,
        pressure,
        winds AS wind_speed,
        windd AS wind_direction,
        rainy,
        reading_date,
        time
      FROM weather_archive
      WHERE device_id = ${device}
        AND id > ${lastId}
      ORDER BY id ASC
      LIMIT ${limit}
    `;

    const nextLastId =
      rows.length > 0
        ? Number(rows[rows.length - 1].id)
        : lastId;

    const hasMore =
      rows.length === limit;

    return res.status(200).json({
      success: true,
      device,
      total,
      count: rows.length,
      hasMore,
      nextLastId:
        hasMore ? nextLastId : null,
      data: rows
    });

  } catch (error) {

    console.error(
      "Weather archive export error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Server error",
      message: error.message
    });
  }
}
