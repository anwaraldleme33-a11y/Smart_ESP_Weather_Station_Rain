import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    // تاريخ اليوم حسب توقيت بغداد
    const baghdadDate = await sql`
      SELECT (NOW() AT TIME ZONE 'Asia/Baghdad')::date AS today
    `;

    // =========================================
    // 1. نقل الأيام السابقة إلى الأرشيف
    // =========================================

    const inserted = await sql`
      INSERT INTO weather_archive (
        device_id,
        temperture,
        humidity,
        pressure,
        winds,
        windd,
        rainy,
        reading_date,
        time
      )
      SELECT
        device_id,
        temperture,
        humidity,
        pressure,
        winds,
        windd,
        rainy,
        reading_date,
        time
      FROM weather_data

      WHERE reading_date <
        (NOW() AT TIME ZONE 'Asia/Baghdad')::date

      ON CONFLICT (device_id, time)
      DO NOTHING

      RETURNING id
    `;

    // =========================================
    // 2. حذف الأيام السابقة من weather_data
    // =========================================

    const deleted = await sql`
      DELETE FROM weather_data

      WHERE reading_date <
        (NOW() AT TIME ZONE 'Asia/Baghdad')::date

      RETURNING id
    `;

    // =========================================
    // 3. النتيجة
    // =========================================

    return res.status(200).json({
      success: true,
      message: "Weather archive completed successfully",
      baghdadDate: baghdadDate[0].today,
      inserted: inserted.length,
      deleted: deleted.length,
      archiveTime: new Date().toISOString()
    });

  } catch (error) {

    console.error("Archive error:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
