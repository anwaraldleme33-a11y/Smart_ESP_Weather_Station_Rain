import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const RAIN_PROXY_MM = 0.2;


// =========================================
// Dew Point
// =========================================

function calculateDewPoint(
  tempC,
  humidity
) {

  const t =
    Number(tempC);

  const h =
    Number(humidity);


  if (
    !Number.isFinite(t) ||
    !Number.isFinite(h) ||
    h <= 0
  ) {

    return null;

  }


  const a = 17.62;
  const b = 243.12;


  const gamma =
    Math.log(h / 100) +
    (
      a * t
    ) /
    (
      b + t
    );


  const dewPoint =
    (
      b * gamma
    ) /
    (
      a - gamma
    );


  return Number(
    dewPoint.toFixed(2)
  );

}


// =========================================
// Wind direction
// =========================================

function windDirectionToDegree(
  direction
) {

  if (
    direction === null ||
    direction === undefined
  ) {

    return 0;

  }


  const d =
    String(direction)
      .trim()
      .toUpperCase();


  const directions = {

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
    directions[d] !==
    undefined
  ) {

    return directions[d];

  }


  const number =
    Number(d);


  if (
    Number.isFinite(number)
  ) {

    return (
      (
        number % 360
      ) +
      360
    ) % 360;

  }


  return 0;

}


// =========================================
// Circular wind mean
// =========================================

function circularMean(
  degreesArray
) {

  if (
    !degreesArray ||
    degreesArray.length === 0
  ) {

    return 0;

  }


  let sinSum = 0;
  let cosSum = 0;


  for (
    const degree
    of degreesArray
  ) {

    const rad =
      degree *
      Math.PI /
      180;


    sinSum +=
      Math.sin(rad);


    cosSum +=
      Math.cos(rad);

  }


  let angle =
    Math.atan2(
      sinSum /
      degreesArray.length,

      cosSum /
      degreesArray.length
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
// Create one AI day
// =========================================

async function createAIDay(
  device,
  targetDate
) {

  const rows =
    await sql`

      SELECT

        temperture,

        humidity,

        pressure,

        winds,

        windd,

        rainy

      FROM
        weather_archive

      WHERE
        device_id =
        ${device}

      AND
        reading_date =
        ${targetDate}

    `;


  if (
    !rows.length
  ) {

    return {

      success:
        false,

      date:
        targetDate,

      error:
        "No source readings"

    };

  }


  let temperatureSum = 0;
  let temperatureCount = 0;

  let humiditySum = 0;
  let humidityCount = 0;

  let pressureSum = 0;
  let pressureCount = 0;

  let windSum = 0;
  let windCount = 0;

  let rainy =
    false;


  const directions =
    [];


  for (
    const row
    of rows
  ) {

    const temperature =
      Number(
        row.temperture
      );


    const humidity =
      Number(
        row.humidity
      );


    const pressure =
      Number(
        row.pressure
      );


    const wind =
      Number(
        row.winds
      );


    if (
      Number.isFinite(
        temperature
      )
    ) {

      temperatureSum +=
        temperature;

      temperatureCount++;

    }


    if (
      Number.isFinite(
        humidity
      )
    ) {

      humiditySum +=
        humidity;

      humidityCount++;

    }


    if (
      Number.isFinite(
        pressure
      )
    ) {

      pressureSum +=
        pressure;

      pressureCount++;

    }


    if (
      Number.isFinite(
        wind
      )
    ) {

      windSum +=
        wind;

      windCount++;

    }


    directions.push(
      windDirectionToDegree(
        row.windd
      )
    );


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

      rainy =
        true;

    }

  }


  const temperature =
    temperatureCount
      ? (
          temperatureSum /
          temperatureCount
        )
      : 0;


  const humidity =
    humidityCount
      ? (
          humiditySum /
          humidityCount
        )
      : 0;


  const pressure =
    pressureCount
      ? (
          pressureSum /
          pressureCount
        )
      : 0;


  const windSpeed =
    windCount
      ? (
          windSum /
          windCount
        )
      : 0;


  const windDirection =
    circularMean(
      directions
    );


  const dewpoint =
    calculateDewPoint(
      temperature,
      humidity
    );


  const rainfall =
    rainy
      ? RAIN_PROXY_MM
      : 0;


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

      ${temperature.toFixed(2)},

      ${humidity.toFixed(2)},

      ${dewpoint},

      ${pressure.toFixed(2)},

      ${windSpeed.toFixed(2)},

      ${windDirection},

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

  `;


  return {

    success:
      true,

    date:
      targetDate,

    sourceReadings:
      rows.length

  };

}


// =========================================
// Main Cron
// =========================================

export default async function handler(
  req,
  res
) {

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
    // 1. Baghdad date
    // =========================================

    const dateResult =
      await sql`

        SELECT

          TO_CHAR(
            (
              NOW()
              AT TIME ZONE
              'Asia/Baghdad'
            )::date,

            'YYYY-MM-DD'
          )

          AS today

      `;


    const baghdadToday =
      dateResult[0].today;


    // =========================================
    // 2. Move previous days to weather_archive
    // =========================================

    const inserted =
      await sql`

        INSERT INTO
          weather_archive
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

        FROM
          weather_data

        WHERE
          reading_date <
          (
            NOW()
            AT TIME ZONE
            'Asia/Baghdad'
          )::date


        ON CONFLICT
        (
          device_id,
          time
        )

        DO NOTHING

        RETURNING id

      `;


    // =========================================
    // 3. Delete transferred old readings
    // =========================================

    const deleted =
      await sql`

        DELETE FROM
          weather_data

        WHERE
          reading_date <
          (
            NOW()
            AT TIME ZONE
            'Asia/Baghdad'
          )::date

        RETURNING id

      `;


    // =========================================
    // 4. Find all missing AI days
    // =========================================

    const missingDates =
      await sql`

        SELECT DISTINCT

          w.device_id,

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
          a.id IS NULL


        ORDER BY
          w.device_id,
          reading_date

      `;


    // =========================================
    // 5. Create missing AI archive days
    // =========================================

    const aiResults =
      [];


    for (
      const row
      of missingDates
    ) {

      try {

        const result =
          await createAIDay(

            row.device_id,

            row.reading_date

          );


        aiResults.push({

          device:
            row.device_id,

          ...result

        });


      } catch (
        error
      ) {

        aiResults.push({

          success:
            false,

          device:
            row.device_id,

          date:
            row.reading_date,

          error:
            error.message

        });

      }

    }


    const aiCreated =
      aiResults.filter(
        item =>
          item.success ===
          true
      ).length;


    const aiFailed =
      aiResults.filter(
        item =>
          item.success !==
          true
      ).length;


    // =========================================
    // Final result
    // =========================================

    return res
      .status(200)
      .json({

        success:
          true,

        message:
          "Daily archive completed successfully",

        baghdadDate:
          baghdadToday,

        weatherArchive: {

          inserted:
            inserted.length,

          deleted:
            deleted.length

        },

        aiArchive: {

          missingDays:
            missingDates.length,

          createdDays:
            aiCreated,

          failedDays:
            aiFailed

        },

        aiResults:
          aiResults

      });


  } catch (
    error
  ) {

    console.error(
      "Daily archive cron error:",
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
