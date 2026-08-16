import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const rows = await sql`
      SELECT id, device_id, temperture, humidity, pressure, windS, windD, rain
      FROM weather_data
    `;
    res.json(rows.reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
