import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);


// =========================================
// حساب Dew Point
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
    (b * gamma) /
    (a - gamma);

  return Number(
    dewPoint.toFixed(2)
  );
}


// =========================================
// تحويل اتجاه الرياح إلى درجة
// =========================================

function windDirectionToDegree(direction) {

  if (!direction) {
    return 0;
  }

  const d =
    String(direction)
      .trim()
      .toUpperCase();


  const map = {

    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,

    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,

    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,

    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5

  };


  if (
    map[d] !== undefined
  ) {

    return map[d];

  }


  // إذا كانت القيمة رقمية
  const num =
    parseFloat(d);


  if (
    !isNaN(num)
  ) {

    return (
      (
        num % 360
      ) +
      360
    ) % 360;

  }


  return 0;
}


// =========================================
// المتوسط الدائري لاتجاه الرياح
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
        deg *
        Math.PI /
        180;


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
    ) *
    180 /
    Math.PI;


  if (
    angle < 0
  ) {

    angle += 360;

  }


  return Number(
    angle.toFixed(2)
  );
}


// =========================================
// إنشاء سجل يومي واحد للـ AI
// =========================================

async function createDailyAIArchive(
  device,
  targetDate
) {

  // =========================================
  // جلب قراءات اليوم من weather_archive
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

      WHERE
        device_id = ${device}

      AND
        reading_date = ${targetDate}

      ORDER BY
        time ASC

    `;


  // =========================================
  // لا توجد بيانات
  // =========================================

  if (
    !rows ||
    rows.length === 0
  ) {

    return {

      success:
        false,

      date:
        targetDate,

      reason:
        "No source readings"

    };

  }


  // =========================================
  // متغيرات المتوسط
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


  // =========================================
  // قراءة البيانات
  // =========================================

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


      // Temperature
      if (
        !isNaN(temp)
      ) {

        tempSum +=
          temp;

        tempCount++;

      }


      // Humidity
      if (
        !isNaN(humidity)
      ) {

        humiditySum +=
          humidity;

        humidityCount++;

      }


      // Pressure
      if (
        !isNaN(pressure)
      ) {

        pressureSum +=
          pressure;

        pressureCount++;

      }


      // Wind speed
      if (
        !isNaN(windSpeed)
      ) {

        windSpeedSum +=
          windSpeed;

        windSpeedCount++;

      }


      // Rain
      if (
        row.rainy === true ||
        row.rainy === 1 ||
        row.rainy === "1" ||
        String(
          row.rainy
        )
          .toLowerCase() ===
          "true"
      ) {

        rainyCount++;

      }


      // Wind direction
      directions.push(

        windDirectionToDegree(
          row.windd
        )

      );

    }
  );


  // =========================================
  // المتوسطات
  // =========================================

  const avgTemperature =
    tempCount > 0
      ? tempSum /
        tempCount
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


  // =========================================
  // Dew Point
  // =========================================

  const dewPoint =
    calculateDewPoint(
      avgTemperature,
      avgHumidity
    );


  // =========================================
  // كمية المطر المؤقتة
  //
  // الحساس الحالي Boolean
  // true = 0.2 mm مؤقتاً
  // =========================================

  const rainfall =
    rainyCount > 0
      ? 0.2
      : 0;


  // =========================================
  // الحفظ في ai_weather_archive
  // =========================================

  const saved =
    await sql`

      INSERT INTO
        ai_weather_archive
      (
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

      VALUES
      (
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


      ON CONFLICT
      (
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

  return {

    success:
      true,

    date:
      targetDate,

    sourceReadings:
      rows.length,

    dailyData:
      saved[0]

  };

}


// =========================================
// API
// =========================================

export default async function handler(
  req,
  res
) {

  // =========================================
  // Method
  // =========================================

  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        success:
          false,

        error:
          "Method not allowed"

      });

  }


  try {

    // =========================================
    // Device
    // =========================================

    const device =
      req.query.device ||
      "max1";


    // =========================================
    // إذا تم تمرير تاريخ يدوي
    //
    // مثال:
    // ?device=max1&date=2026-08-18
    // =========================================

    const requestedDate =
      req.query.date;


    if (
      requestedDate
    ) {

      const result =
        await createDailyAIArchive(
          device,
          requestedDate
        );


      return res
        .status(
          result.success
            ? 200
            : 404
        )
        .json({

          success:
            result.success,

          message:
            result.success
              ? "AI daily archive created successfully"
              : "No archive data found",

          device:
            device,

          date:
            requestedDate,

          result:
            result

        });

    }


    // =========================================
    // جلب الأيام الناقصة
    //
    // TO_CHAR يحل مشكلة:
    // Wed Aug 19
    //
    // ويعيد:
    // 2026-08-19
    // =========================================

    const missingDates =
      await sql`

        SELECT DISTINCT

          TO_CHAR(
            w.reading_date,
            'YYYY-MM-DD'
          )
          AS reading_date

        FROM
          weather_archive w


        LEFT JOIN
          ai_weather_archive a

        ON
          a.device_id =
          w.device_id

        AND
          a.reading_date =
          w.reading_date


        WHERE
          w.device_id =
          ${device}


        AND
          a.id IS NULL


        ORDER BY
          reading_date ASC

      `;


    // =========================================
    // لا توجد أيام ناقصة
    // =========================================

    if (
      !missingDates ||
      missingDates.length === 0
    ) {

      return res
        .status(200)
        .json({

          success:
            true,

          message:
            "AI archive is already up to date",

          device:
            device,

          missingDays:
            0,

          createdDays:
            0,

          failedDays:
            0,

          results:
            []

        });

    }


    // =========================================
    // إنشاء جميع الأيام الناقصة
    // =========================================

    const results =
      [];


    for (
      const row
      of missingDates
    ) {

      // التاريخ الآن أصلاً:
      // YYYY-MM-DD
      const date =
        row.reading_date;


      try {

        const result =
          await createDailyAIArchive(
            device,
            date
          );


        results.push(
          result
        );


      } catch (
        error
      ) {

        results.push({

          success:
            false,

          date:
            date,

          error:
            error.message

        });

      }

    }


    // =========================================
    // حساب الأيام الناجحة
    // =========================================

    const createdDays =
      results.filter(
        item =>
          item.success ===
          true
      ).length;


    // =========================================
    // حساب الأيام الفاشلة
    // =========================================

    const failedDays =
      results.filter(
        item =>
          item.success !==
          true
      ).length;


    // =========================================
    // النتيجة النهائية
    // =========================================

    return res
      .status(200)
      .json({

        success:
          true,

        message:
          "Missing AI archive days processed",

        device:
          device,

        missingDays:
          missingDates.length,

        createdDays:
          createdDays,

        failedDays:
          failedDays,

        results:
          results

      });


  } catch (
    error
  ) {

    console.error(
      "AI Archive Error:",
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
