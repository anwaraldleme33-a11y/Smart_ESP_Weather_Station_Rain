import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const allowedDevices = ['max1', 'max2', 'max3', 'max4'];

    // تحديد الجهاز من query params
    const device = (req.query.device || '').toLowerCase();

    if (!allowedDevices.includes(device)) {
      return res.status(400).json({
        message: "Invalid device (must be max1..max4)",
        received: device,
      });
    }

    // اختيار الجدول بناءً على device_id
    const tableName = `${device}_data`;

    const rows = await sql.unsafe(`
      SELECT id, device_id, temperture, humidity, pressure, windS, windD, rain
      FROM weather_data
      ORDER BY time ASC
      LIMIT 100
    `);

    res.status(200).json(rows);
  } catch (e) {
    console.error('Database error:', e);
    res.status(500).json({ error: e.message });
  }
}
