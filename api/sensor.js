import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // POST - إضافة بيانات جديدة
    if (req.method === "POST") {
      const { device_id, temperture, humidity, pressure, windS, windD } = req.body ?? {};

      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({ error: "invalid device" });
      }

      await sql`
        INSERT INTO weather_data (device_id, temperture, humidity, pressure, windS, windD)
        VALUES (${device_id}, ${Number(temperture)}, ${Number(humidity)}, ${Number(pressure)}, ${Number(windS)}, ${windD})
      `;

      return res.status(200).json({ status: "saved" });
    }

    // GET - جلب البيانات
    if (req.method === "GET") {
      const { device, date } = req.query;

      if (!allowedDevices.includes(device)) {
        return res.status(400).json({ error: "invalid device" });
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

      return res.status(200).json(todayRows);
    }

    return res.status(405).json({ error: "method not allowed" });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ 
      error: "server error", 
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
}
