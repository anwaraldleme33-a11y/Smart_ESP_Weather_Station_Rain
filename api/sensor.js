import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {
  try {

    /* =======================
       POST (ESP32 → Database)
       ======================= */
    if (req.method === "POST") {
      const { device_id, temperture, humidity, pressure, windS, windD, rain } = req.body || {};
        
      if (!allowedDevices.includes(device_id)) {
        return res.status(400).json({
          message: "Invalid device (must be max1..max4)",
          received: device_id
        });
      }

      await sql`
        INSERT INTO weather_data (device_id, temperture, humidity, pressure, windS, windD, rain)
        VALUES (${device_id}, ${temperture}, ${humidity}, ${pressure}, ${windS}, ${windD}, ${rain})
      `;

      return res.status(200).json({ message: "Data saved successfully" });
    }

    /* =======================
       GET (Dashboard ← DB)
       ======================= */
    if (req.method === "GET") {
      const device = req.query.device;

      if (!allowedDevices.includes(device)) {
        return res.status(400).json({
          message: "Invalid device (must be max1..max4)",
          received: device
        });
      }

      const rows = await sql`
        SELECT device_id, temperture, humidity, pressure, windS, windD, rain
        FROM weather_data
        WHERE device_id = ${device}
        ORDER BY time ASC
      `;

      return res.status(200).json(rows);
    }

    return res.status(405).json({ message: "Method not allowed" });

  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
