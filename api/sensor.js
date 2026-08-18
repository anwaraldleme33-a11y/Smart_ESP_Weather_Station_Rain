import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

// ===== دالة للحصول على وقت بغداد =====
function getBaghdadTime() {
    const now = new Date();
    const baghdadTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return baghdadTime.toISOString();
}

// ===== دالة للحصول على تاريخ بغداد =====
function getBaghdadDate() {
    const now = new Date();
    const baghdadTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return baghdadTime.toISOString().split('T')[0];
}

/* ===== أرشفة بيانات الأمس مرة واحدة فقط ===== */
async function archiveYesterdayData() {
  try {
    const baghdadDate = getBaghdadDate();
    
    await sql`
      INSERT INTO weather_archive
      (device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date, time)
      SELECT device_id, temperture, humidity, pressure, windS, windD, rainy, DATE(time), time
      FROM weather_data
      WHERE DATE(time) = ${baghdadDate} - INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM weather_archive wa
        WHERE wa.device_id = weather_data.device_id
        AND wa.reading_date = DATE(weather_data.time)
      )
    `;
  } catch (err) {
    console.error("Archive error:", err);
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

    await archiveYesterdayData();

    /* ========= POST ========= */
    if (req.method === "POST") {

      const {
        device_id,
        temperture,
        humidity,
        pressure,
        windS,
        windD,
        rain  // من ESP32
      } = req.body ?? {};

      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({ error: "invalid device" });
      }

      // تحويل rain إلى boolean
      let rainValue = false;
      if (rain !== undefined && rain !== null) {
        if (typeof rain === 'string') {
          // إذا كانت القيمة "rainy" أو "true" أو "1"
          rainValue = rain.toLowerCase() === 'rainy' || 
                      rain.toLowerCase() === 'true' || 
                      rain === '1';
        } else {
          rainValue = Boolean(rain);
        }
      }

      // الحصول على وقت وتاريخ بغداد
      const baghdadTime = getBaghdadTime();
      const baghdadDate = getBaghdadDate();

      console.log('=== POST Request ===');
      console.log('device_id:', device_id);
      console.log('rain received:', rain);
      console.log('rain converted:', rainValue);
      console.log('Baghdad Time:', baghdadTime);
      console.log('Baghdad Date:', baghdadDate);
      console.log('===================');

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
          ${baghdadTime}
        )
      `;

      return res.status(200).json({ 
        status: "saved", 
        rainy: rainValue,
        time: baghdadTime,
        date: baghdadDate
      });
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
          SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date, time
          FROM weather_archive
          WHERE device_id = ${device}
          AND reading_date = ${date}
          ORDER BY reading_date ASC
        `;
        return res.status(200).json(rows);
      }

      /* ===== الوضع الافتراضي ===== */
      
      // الحصول على تاريخ بغداد الحالي
      const baghdadDate = getBaghdadDate();

      const todayRows = await sql`
        SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date, time
        FROM weather_data
        WHERE device_id = ${device}
        AND reading_date = ${baghdadDate}
        ORDER BY time ASC
      `;

      const yesterdayRows = await sql`
        SELECT id, device_id, temperture, humidity, pressure, windS, windD, rainy, reading_date, time
        FROM weather_archive
        WHERE device_id = ${device}
        AND reading_date = ${baghdadDate} - INTERVAL '1 day'
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
