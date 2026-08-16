import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ message:'Method not allowed' });

  const { device_id, temperture, humidity, pressure, windS, windD, rain } = req.body;

  await sql`
    INSERT INTO weather_data (device_id, temperture, humidity, pressure, windS, windD, rain)
    VALUES(${device_id}, ${temperture}, ${humidity}, ${pressure}, ${windS}, ${windD}, ${rain})
  `;

  res.json({ success:true });
}
