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

    // =========================================
    // نقل البيانات القديمة
    // =========================================

    const result = await sql`
      WITH moved AS (

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

        RETURNING device_id, time
      )

      SELECT COUNT(*) AS count
      FROM moved
    `;


    // =========================================
    // حذف البيانات القديمة
    // =========================================

    const deleteResult = await sql`
      DELETE FROM weather_data
      WHERE reading_date < CURRENT_DATE
      RETURNING id
    `;


    return res.status(200).json({
      success: true,
      archived: Number(result[0].count),
      deleted: deleteResult.length,
      message: "Archive completed successfully"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
