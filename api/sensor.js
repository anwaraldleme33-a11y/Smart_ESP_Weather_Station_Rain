import { neon } from "@neondatabase/serverless";

const sql =
  neon(
    process.env.DATABASE_URL
  );


const allowedDevices =
  new Set([
    "max1",
    "max2",
    "max3",
    "max4"
  ]);


// =========================================
// API
// =========================================

export default async function handler(
  req,
  res
) {

  // منع Cache / 304
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader(
    "CDN-Cache-Control",
    "no-store"
  );

  res.setHeader(
    "Vercel-CDN-Cache-Control",
    "no-store"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  // =========================================
  // OPTIONS
  // =========================================

  if (
    req.method === "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  // =========================================
  // POST
  // ESP32 -> Neon
  // =========================================

  if (
    req.method === "POST"
  ) {

    try {

      const {
        device_id,
        temperture,
        humidity,
        pressure,

        windS,
        windD,

        winds,
        windd,

        rainy
      } =
        req.body || {};


      if (
        !allowedDevices.has(
          device_id
        )
      ) {

        return res
          .status(400)
          .json({
            success: false,
            error:
              "Invalid device"
          });

      }


      const temperatureValue =
        Number(
          temperture
        );


      const humidityValue =
        Number(
          humidity
        );


      const pressureValue =
        Number(
          pressure
        );


      const windSpeedValue =
        Number(
          windS ??
          winds ??
          0
        );


      const windDirectionValue =
        String(
          windD ??
          windd ??
          "N"
        );


      const rainyValue =
        rainy === true ||
        rainy === 1 ||
        rainy === "1" ||
        String(
          rainy
        ).toLowerCase() ===
          "true";


      if (
        !Number.isFinite(
          temperatureValue
        ) ||
        !Number.isFinite(
          humidityValue
        ) ||
        !Number.isFinite(
          pressureValue
        ) ||
        !Number.isFinite(
          windSpeedValue
        )
      ) {

        return res
          .status(400)
          .json({
            success: false,
            error:
              "Invalid sensor data"
          });

      }


      // =========================================
      // حفظ القراءة
      // =========================================

      await sql`

        INSERT INTO
          weather_data
        (
          device_id,
          temperture,
          humidity,
          pressure,
          winds,
          windd,
          rainy,
          reading_date,
          time
        )

        VALUES
        (
          ${device_id},

          ${temperatureValue},

          ${humidityValue},

          ${pressureValue},

          ${windSpeedValue},

          ${windDirectionValue},

          ${rainyValue},

          (
            NOW()
            AT TIME ZONE
            'Asia/Baghdad'
          )::date,

          NOW()
        )

      `;


      return res
        .status(200)
        .json({
          success: true,
          message:
            "Sensor reading saved"
        });


    } catch (
      error
    ) {

      console.error(
        "Sensor POST Error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,
          error:
            error.message
        });

    }

  }


  // =========================================
  // GET
  // =========================================

  if (
    req.method === "GET"
  ) {

    try {

      const device =
        req.query.device ||
        "max1";


      const date =
        req.query.date;


      if (
        !allowedDevices.has(
          device
        )
      ) {

        return res
          .status(400)
          .json({
            success: false,
            error:
              "Invalid device"
          });

      }


      // =========================================
      // إذا يوجد date
      //
      // الصفحة تطلب الأرشيف
      // =========================================

      if (
        date
      ) {

        const archiveRows =
          await sql`

            SELECT

              id,

              device_id,

              temperture,

              humidity,

              pressure,

              winds,

              windd,

              rainy,

              reading_date,

              time

            FROM
              weather_archive

            WHERE
              device_id =
              ${device}

            AND
              reading_date =
              ${date}

            ORDER BY
              time ASC

          `;


        // مهم:
        // الصفحة الحالية تتوقع Array
        return res
          .status(200)
          .json(
            archiveRows
          );

      }


      // =========================================
      // بدون date
      //
      // الصفحة الرئيسية:
      // آخر قراءة فقط
      // =========================================

      const rows =
        await sql`

          SELECT

            id,

            device_id,

            temperture,

            humidity,

            pressure,

            winds,

            windd,

            rainy,

            reading_date,

            time

          FROM
            weather_data

          WHERE
            device_id =
            ${device}

          ORDER BY
            time DESC

          LIMIT 1

        `;


      /*
        نحافظ على شكل الاستجابة
        الذي تدعمه الصفحة الحالية.
      */

      return res
        .status(200)
        .json({

          success:
            true,

          device:
            device,

          today:
            rows

        });


    } catch (
      error
    ) {

      console.error(
        "Sensor GET Error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,
          error:
            error.message
        });

    }

  }


  // =========================================
  // غير مسموح
  // =========================================

  return res
    .status(405)
    .json({
      success: false,
      error:
        "Method not allowed"
    });

}
