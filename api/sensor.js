import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

/* ===== أرشفة بيانات الأمس مرة واحدة فقط ===== */
async function archiveYesterdayData() {
  try {
    await sql`
      INSERT INTO weather_archive
      (device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date)
      SELECT device_id, temperture, humidity, pressure, windS, windD, rainy, DATE(time)
      FROM weather_data
      WHERE DATE(time) = CURRENT_DATE - INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM weather_archive wa
        WHERE wa.device_id = weather_data.device_id
        AND wa.reading_date = DATE(weather_data.time)
      )
    `;
  } catch (err) {
    console.error("Archive error:", err);
    // لا نرمي الخطأ لأن الأرشفة ليست حرجة
  }
}

export default async function handler(req, res) {
  try {

    /* ===== CORS ===== */
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    /* ========= POST ========= */
    if (req.method === "POST") {

      const {
        device_id,
        temperture,
        humidity,
        pressure,
        windS,
        windD,
        rainy
      } = req.body ?? {};

      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({ error: "invalid device" });
      }

      // تحويل rainy إلى boolean
      let rainValue = false;
      if (rainy !== undefined && rainy !== null) {
        if (typeof rainy === 'string') {
          rainValue = rainy.toLowerCase() === 'true' || rainy === '1';
        } else {
          rainValue = Boolean(rainy);
        }
      }

      await sql`
        INSERT INTO weather_data
        (device_id, temperture, humidity, pressure, windS, windD, rainy)
        VALUES (
          ${device_id},
          ${Number(temperture)},
          ${Number(humidity)},
          ${Number(pressure)},
          ${Number(windS)},
          ${windD},
          ${rainValue}
        )
      `;

      return res.status(200).json({ status: "saved" });
    }

    /* ========= GET ========= */
    if (req.method === "GET") {

      const { device, date } = req.query;

      if (!allowedDevices.includes(device)) {
        return res.status(400).json({ error: "invalid device" });
      }

      /* ===== طلب أرشيف حسب تاريخ ===== */
      if (date) {
        const rows = await sql`
          SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date as time
          FROM weather_archive
          WHERE device_id = ${device}
          AND reading_date = ${date}
          ORDER BY reading_date ASC
        `;
        return res.status(200).json(rows);
      }

      /* ===== الوضع الافتراضي ===== */

      // جلب بيانات اليوم
      const todayRows = await sql`
        SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, time
        FROM weather_data
        WHERE device_id = ${device}
        AND DATE(time) = CURRENT_DATE
        ORDER BY time ASC
      `;

      // جلب بيانات الأمس من الأرشيف
      const yesterdayRows = await sql`
        SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date as time
        FROM weather_archive
        WHERE device_id = ${device}
        AND reading_date = CURRENT_DATE - INTERVAL '1 day'
        ORDER BY reading_date ASC
      `;

      return res.status(200).json({
        today: todayRows,
        yesterday: yesterdayRows
      });
    }

    return res.status(405).json({ error: "method not allowed" });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "server error",
      details: err.message
    });
  }
}
