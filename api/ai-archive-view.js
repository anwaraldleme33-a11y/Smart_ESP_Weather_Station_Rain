import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const allowedDevices =
  new Set([
    "max1",
    "max2",
    "max3",
    "max4"
  ]);

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({
        success: false,
        error: "Method not allowed"
      });

  }


  try {

    const device =
      req.query.device ||
      "max1";


    if (
      !allowedDevices.has(
        device
      )
    ) {

      return res
        .status(400)
        .json({
          success: false,
          error: "Invalid device"
        });

    }


    const rows =
      await sql`

        SELECT

          id,

          device_id,

          TO_CHAR(
            reading_date,
            'YYYY-MM-DD'
          )
          AS reading_date,

          temperature,

          humidity,

          dewpoint,

          pressure,

          wind_speed,

          wind_direction,

          rainfall,

          created_at

        FROM
          ai_weather_archive

        WHERE
          device_id =
          ${device}

        ORDER BY
          reading_date
          DESC

        LIMIT 100

      `;


    return res
      .status(200)
      .json({

        success:
          true,

        device:
          device,

        count:
          rows.length,

        data:
          rows

      });


  } catch (
    error
  ) {

    console.error(
      "AI Archive View Error:",
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          error.message

      });

  }

}
