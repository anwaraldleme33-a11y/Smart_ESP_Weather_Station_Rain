import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // ===== POST =====
    if (req.method === "POST") {
      const { device_id, temperture, humidity, pressure, windS, windD, rain } = req.body || {};

      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({ error: "جهاز غير صالح" });
      }

      let rainValue = false;
      if (rain !== undefined && rain !== null) {
        if (typeof rain === 'string') {
          rainValue = rain.toLowerCase() === 'rainy' || rain.toLowerCase() === 'true' || rain === '1';
        } else {
          rainValue = Boolean(rain);
        }
      }

      const now = new Date();
      const baghdadTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
      const baghdadDate = baghdadTime.toISOString().split('T')[0];
      const baghdadTimeStr = baghdadTime.toISOString();

      await sql`
        INSERT INTO weather_data
        (device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date, time)
        VALUES (
          ${device_id},
          ${Number(temperture)},
          ${Number(humidity)},
          ${Number(pressure)},
          ${Number(windS)},
          ${windD},
          ${rainValue},
          ${baghdadDate},
          ${baghdadTimeStr}
        )
      `;

      return res.status(200).json({ status: "saved", rainy: rainValue });
    }

    // ===== GET =====
    if (req.method === "GET") {
      const { device, date } = req.query;

      if (!allowedDevices.includes(device)) {
        return res.status(400).json({ error: "جهاز غير صالح" });
      }

      // جلب الأرشيف حسب التاريخ
      if (date) {
        const rows = await sql`
          SELECT * FROM weather_archive
          WHERE device_id = ${device}
          AND reading_date = ${date}
          ORDER BY reading_date ASC
        `;
        return res.status(200).json(rows);
      }

      // جلب بيانات اليوم
      const now = new Date();
      const baghdadTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
      const baghdadDate = baghdadTime.toISOString().split('T')[0];

      // محاولة جلب بيانات اليوم
      let todayRows = await sql`
        SELECT * FROM weather_data
        WHERE device_id = ${device}
        AND reading_date = ${baghdadDate}
        ORDER BY time ASC
      `;

      // إذا لم توجد بيانات اليوم، جلب آخر 20 قراءة
      if (todayRows.length === 0) {
        todayRows = await sql`
          SELECT * FROM weather_data
          WHERE device_id = ${device}
          ORDER BY time DESC
          LIMIT 20
        `;
        todayRows = todayRows.reverse();
      }

      // جلب بيانات الأمس من الأرشيف
      const yesterdayDate = new Date(baghdadTime);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayDateStr = yesterdayDate.toISOString().split('T')[0];

      const yesterdayRows = await sql`
        SELECT * FROM weather_archive
        WHERE device_id = ${device}
        AND reading_date = ${yesterdayDateStr}
        ORDER BY reading_date ASC
      `;

      return res.status(200).json({
        today: todayRows,
        yesterday: yesterdayRows
      });
    }

    return res.status(405).json({ error: "طريقة غير مسموحة" });

  } catch (error) {
    console.error("خطأ في الخادم:", error);
    return res.status(500).json({
      error: "خطأ في الخادم",
      message: error.message
    });
  }
}
