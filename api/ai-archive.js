import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// =========================================
// حساب Dew Point
// Magnus Formula
// =========================================
function calculateDewPoint(tempC, humidity) {

  if (
    tempC === null ||
    humidity === null ||
    isNaN(tempC) ||
    isNaN(humidity) ||
    humidity <= 0
  ) {
    return null;
  }

  const a = 17.62;
  const b = 243.12;

  const gamma =
    Math.log(humidity / 100) +
    (a * tempC) / (b + tempC);

  const dewPoint =
    (b * gamma) / (a - gamma);

  return Number(dewPoint.toFixed(2));
}


// =========================================
// تحويل اتجاه الرياح إلى درجة
// =========================================
function windDirectionToDegree(direction) {

  if (!direction) return 0;

  const d =
    String(direction)
      .trim()
      .toUpperCase();

  const map = {
    "N": 0,
    "NE": 45,
    "E": 90,
    "SE": 135,
    "S": 180,
    "SW": 225,
    "W": 270,
    "NW": 315
  };

  if (map[d] !== undefined) {
    return map[d];
  }

  // إذا كانت القيمة رقمية أصلاً
  const num =
    parseFloat(d);

  if (!isNaN(num)) {
    return num % 360;
  }

  return 0;
}


// =========================================
// حساب متوسط اتجاه الرياح Circular Mean
// =========================================
function circularMean(degreesArray) {

  if (
    !degreesArray ||
    degreesArray.length === 0
  ) {
    return 0;
  }

  let sinSum = 0;
  let cosSum = 0;

  degreesArray.forEach(
    function(deg) {

      const rad =
        deg * Math.PI / 180;

      sinSum +=
        Math.sin(rad);

      cosSum +=
        Math.cos(rad);

    }
  );

  const avgSin =
    sinSum /
    degreesArray.length;

  const avgCos =
    cosSum /
    degreesArray.length;

  let angle =
    Math.atan2(
      avgSin,
      avgCos
    ) * 180 / Math.PI;

  if (angle < 0) {
    angle += 360;
  }

  return Number(
    angle.toFixed(2)
  );
}


// =========================================
// API
// =========================================
export default async function handler(
  req,
  res
) {

  if (req.method !== "GET") {

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

    const date =
      req.query.date;


    // =========================================
    // إذا لم يرسل تاريخ
    // استخدم آخر يوم موجود في weather_archive
    // =========================================

    let targetDate =
      date;


    if (!targetDate) {

      const lastDate =
        await sql`
          SELECT
            MAX(reading_date) AS reading_date
          FROM weather_archive
          WHERE device_id = ${device}
        `;


      if (
        !lastDate ||
        lastDate.length === 0 ||
        !lastDate[0].reading_date
      ) {

        return res
          .status(404)
          .json({
            success: false,
            error:
              "No archive data found for this device"
          });

      }


      targetDate =
        String(
          lastDate[0].reading_date
        ).slice(0, 10);

    }


    // =========================================
    // جلب بيانات اليوم
    // =========================================

    const rows =
      await sql`
        SELECT
          device_id,
          temperture,
          humidity,
          pressure,
          winds,
          windd,
          rainy,
          reading_date,
          time
        FROM weather_archive
        WHERE device_id = ${device}
        AND reading_date = ${targetDate}
        ORDER BY time ASC
      `;


    if (
      !rows ||
      rows.length === 0
    ) {

      return res
        .status(404)
        .json({
          success: false,
          device: device,
          date: targetDate,
          error:
            "No archive data found for this date"
        });

    }


    // =========================================
    // حساب المتوسطات
    // =========================================

    let tempSum = 0;
    let humiditySum = 0;
    let pressureSum = 0;
    let windSpeedSum = 0;

    let tempCount = 0;
    let humidityCount = 0;
    let pressureCount = 0;
    let windSpeedCount = 0;

    let rainyCount = 0;

    const directions =
      [];


    rows.forEach(
      function(row) {

        const temp =
          parseFloat(
            row.temperture
          );

        const humidity =
          parseFloat(
            row.humidity
          );

        const pressure =
          parseFloat(
            row.pressure
          );

        const windSpeed =
          parseFloat(
            row.winds
          );


        if (!isNaN(temp)) {

          tempSum += temp;
          tempCount++;

        }


        if (!isNaN(humidity)) {

          humiditySum +=
            humidity;

          humidityCount++;

        }


        if (!isNaN(pressure)) {

          pressureSum +=
            pressure;

          pressureCount++;

        }


        if (!isNaN(windSpeed)) {

          windSpeedSum +=
            windSpeed;

          windSpeedCount++;

        }


        if (
          row.rainy === true ||
          row.rainy === 1 ||
          row.rainy === "true" ||
          row.rainy === "1"
        ) {

          rainyCount++;

        }


        directions.push(
          windDirectionToDegree(
            row.windd
          )
        );

      }
    );


    const avgTemperature =
      tempCount > 0
        ? tempSum / tempCount
        : 0;


    const avgHumidity =
      humidityCount > 0
        ? humiditySum /
          humidityCount
        : 0;


    const avgPressure =
      pressureCount > 0
        ? pressureSum /
          pressureCount
        : 0;


    const avgWindSpeed =
      windSpeedCount > 0
        ? windSpeedSum /
          windSpeedCount
        : 0;


    const avgWindDirection =
      circularMean(
        directions
      );


    const dewPoint =
      calculateDewPoint(
        avgTemperature,
        avgHumidity
      );


    // =========================================
    // المطر
    //
    // حاليا الحساس Boolean فقط.
    // إذا ظهر المطر مرة واحدة على الأقل
    // نضع 0.2 mm مؤقتاً.
    // =========================================

    const rainfall =
      rainyCount > 0
        ? 0.2
        : 0;


    // =========================================
    // الحفظ في جدول AI
    // =========================================

    const saved =
      await sql`
        INSERT INTO ai_weather_archive (
          device_id,
          reading_date,
          temperature,
          humidity,
          dewpoint,
          pressure,
          wind_speed,
          wind_direction,
          rainfall
        )
        VALUES (
          ${device},
          ${targetDate},
          ${avgTemperature.toFixed(2)},
          ${avgHumidity.toFixed(2)},
          ${dewPoint},
          ${avgPressure.toFixed(2)},
          ${avgWindSpeed.toFixed(2)},
          ${avgWindDirection},
          ${rainfall}
        )

        ON CONFLICT (
          device_id,
          reading_date
        )

        DO UPDATE SET

          temperature =
            EXCLUDED.temperature,

          humidity =
            EXCLUDED.humidity,

          dewpoint =
            EXCLUDED.dewpoint,

          pressure =
            EXCLUDED.pressure,

          wind_speed =
            EXCLUDED.wind_speed,

          wind_direction =
            EXCLUDED.wind_direction,

          rainfall =
            EXCLUDED.rainfall

        RETURNING *
      `;


    // =========================================
    // النتيجة
    // =========================================

    return res
      .status(200)
      .json({
        success: true,

        message:
          "AI daily archive created successfully",

        device:
          device,

        date:
          targetDate,

        sourceReadings:
          rows.length,

        dailyData:
          saved[0]
      });


  } catch (error) {

    console.error(
      "AI Archive Error:",
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
