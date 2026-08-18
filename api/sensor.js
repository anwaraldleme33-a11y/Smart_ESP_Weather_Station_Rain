import { neon } from "@neondatabase/serverless";

// تهيئة اتصال قاعدة البيانات
const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {
  // إعدادات CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // معالجة طلبات OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // POST - إضافة بيانات جديدة
    if (req.method === "POST") {
      const { device_id, temperture, humidity, pressure, windS, windD } = req.body || {};

      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({ error: "جهاز غير صالح" });
      }

      await sql`
        INSERT INTO weather_data (device_id, temperture, humidity, pressure, windS, windD)
        VALUES (${device_id}, ${Number(temperture)}, ${Number(humidity)}, ${Number(pressure)}, ${Number(windS)}, ${windD})
      `;

      return res.status(200).json({ status: "تم الحفظ" });
    }

    // GET - جلب البيانات
    if (req.method === "GET") {
      const { device, date } = req.query;

      if (!allowedDevices.includes(device)) {
        return res.status(400).json({ error: "جهاز غير صالح" });
      }

      // جلب بيانات الأرشيف حسب التاريخ
      if (date) {
        const rows = await sql`
          SELECT * FROM weather_archive
          WHERE device_id = ${device} AND reading_date = ${date}
          ORDER BY reading_date ASC
        `;
        return res.status(200).json(rows);
      }

      // جلب بيانات اليوم
      const todayRows = await sql`
        SELECT * FROM weather_data
        WHERE device_id = ${device} AND DATE(time) = CURRENT_DATE
        ORDER BY time ASC
      `;

      // إذا لم توجد بيانات اليوم، جلب آخر 10 قراءات
      if (todayRows.length === 0) {
        const lastRows = await sql`
          SELECT * FROM weather_data
          WHERE device_id = ${device}
          ORDER BY time DESC
          LIMIT 10
        `;
        return res.status(200).json(lastRows.reverse());
      }

      return res.status(200).json(todayRows);
    }

    return res.status(405).json({ error: "طريقة غير مسموحة" });

  } catch (error) {
    console.error("خطأ في API:", error);
    return res.status(500).json({ 
      error: "خطأ في الخادم", 
      details: error.message 
    });
  }
}
