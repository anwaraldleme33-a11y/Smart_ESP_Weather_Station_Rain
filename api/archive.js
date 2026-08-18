import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    // =========================================
    // 1. نقل البيانات القديمة إلى الأرشيف
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
      WHERE reading_date < CURRENT_DATE

      ON CONFLICT (device_id, time)
      DO NOTHING
    `;


    // =========================================
    // 2. حذف البيانات القديمة فقط
    // =========================================

    const deleted = await sql`
      DELETE FROM weather_data
      WHERE reading_date < CURRENT_DATE
    `;


    // =========================================
    // 3. النتيجة
    // =========================================

    return res.status(200).json({
      success: true,
      message: "Weather archive completed successfully",
      inserted: inserted.length,
      deleted: deleted.length
    });

  } catch (error) {

    console.error("Archive error:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
