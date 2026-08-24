import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);


// =========================================
// Main Daily Cron
// =========================================

export default async function handler(
  req,
  res
) {

  if (
    req.method !== "GET"
  ) {

    return res
      .status(405)
      .json({
        success: false,
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
    // 2. نقل بيانات الأيام السابقة
    //
    // PostgreSQL يقوم بالعملية داخلياً.
    // لا يتم إرسال آلاف الصفوف إلى Vercel.
    // =========================================

    const archiveResult =
      await sql`

        WITH moved AS (

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


          RETURNING 1

        )

        SELECT
          COUNT(*)::integer
          AS count

        FROM moved

      `;


    const insertedCount =
      Number(
        archiveResult[0]
          ?.count ||
        0
      );


    // =========================================
    // 3. حذف البيانات التي تم أرشفتها
    //
    // نرجع العدد فقط وليس كل IDs
    // =========================================

    const deleteResult =
      await sql`

        WITH deleted AS (

          DELETE FROM
            weather_data

          WHERE
            reading_date <
            (
              NOW()
              AT TIME ZONE
              'Asia/Baghdad'
            )::date

          RETURNING 1

        )

        SELECT
          COUNT(*)::integer
          AS count

        FROM deleted

      `;


    const deletedCount =
      Number(
        deleteResult[0]
          ?.count ||
        0
      );


    // =========================================
    // 4. الأيام الناقصة في AI Archive
    //
    // هنا لا نقرأ القراءات نفسها.
    // نحصل فقط على device + date.
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


    const aiResults =
      [];


    // =========================================
    // 5. إنشاء AI Archive
    //
    // كل العمليات الحسابية تتم داخل Neon.
    //
    // لا يتم تنزيل آلاف القراءات إلى Vercel.
    // =========================================

    for (
      const item
      of missingDates
    ) {

      const device =
        item.device_id;


      const date =
        item.reading_date;


      try {

        const result =
          await sql`

            WITH daily AS (

              SELECT

                AVG(
                  temperture
                )::double precision
                AS temperature,


                AVG(
                  humidity
                )::double precision
                AS humidity,


                AVG(
                  pressure
                )::double precision
                AS pressure,


                AVG(
                  winds
                )::double precision
                AS wind_speed,


                BOOL_OR(
                  COALESCE(
                    rainy,
                    false
                  )
                )
                AS rainy,


                AVG(

                  SIN(

                    RADIANS(

                      CASE
                        WHEN UPPER(TRIM(windd)) = 'N'
                          THEN 0
                        WHEN UPPER(TRIM(windd)) = 'NNE'
                          THEN 22.5
                        WHEN UPPER(TRIM(windd)) = 'NE'
                          THEN 45
                        WHEN UPPER(TRIM(windd)) = 'ENE'
                          THEN 67.5
                        WHEN UPPER(TRIM(windd)) = 'E'
                          THEN 90
                        WHEN UPPER(TRIM(windd)) = 'ESE'
                          THEN 112.5
                        WHEN UPPER(TRIM(windd)) = 'SE'
                          THEN 135
                        WHEN UPPER(TRIM(windd)) = 'SSE'
                          THEN 157.5
                        WHEN UPPER(TRIM(windd)) = 'S'
                          THEN 180
                        WHEN UPPER(TRIM(windd)) = 'SSW'
                          THEN 202.5
                        WHEN UPPER(TRIM(windd)) = 'SW'
                          THEN 225
                        WHEN UPPER(TRIM(windd)) = 'WSW'
                          THEN 247.5
                        WHEN UPPER(TRIM(windd)) = 'W'
                          THEN 270
                        WHEN UPPER(TRIM(windd)) = 'WNW'
                          THEN 292.5
                        WHEN UPPER(TRIM(windd)) = 'NW'
                          THEN 315
                        WHEN UPPER(TRIM(windd)) = 'NNW'
                          THEN 337.5
                        ELSE 0
                      END

                    )

                  )

                )
                AS wind_sin,


                AVG(

                  COS(

                    RADIANS(

                      CASE
                        WHEN UPPER(TRIM(windd)) = 'N'
                          THEN 0
                        WHEN UPPER(TRIM(windd)) = 'NNE'
                          THEN 22.5
                        WHEN UPPER(TRIM(windd)) = 'NE'
                          THEN 45
                        WHEN UPPER(TRIM(windd)) = 'ENE'
                          THEN 67.5
                        WHEN UPPER(TRIM(windd)) = 'E'
                          THEN 90
                        WHEN UPPER(TRIM(windd)) = 'ESE'
                          THEN 112.5
                        WHEN UPPER(TRIM(windd)) = 'SE'
                          THEN 135
                        WHEN UPPER(TRIM(windd)) = 'SSE'
                          THEN 157.5
                        WHEN UPPER(TRIM(windd)) = 'S'
                          THEN 180
                        WHEN UPPER(TRIM(windd)) = 'SSW'
                          THEN 202.5
                        WHEN UPPER(TRIM(windd)) = 'SW'
                          THEN 225
                        WHEN UPPER(TRIM(windd)) = 'WSW'
                          THEN 247.5
                        WHEN UPPER(TRIM(windd)) = 'W'
                          THEN 270
                        WHEN UPPER(TRIM(windd)) = 'WNW'
                          THEN 292.5
                        WHEN UPPER(TRIM(windd)) = 'NW'
                          THEN 315
                        WHEN UPPER(TRIM(windd)) = 'NNW'
                          THEN 337.5
                        ELSE 0
                      END

                    )

                  )

                )
                AS wind_cos,


                COUNT(*)::integer
                AS source_readings


              FROM
                weather_archive


              WHERE
                device_id =
                ${device}

              AND
                reading_date =
                ${date}

            ),


            calculated AS (

              SELECT

                temperature,

                humidity,

                pressure,

                wind_speed,

                rainy,

                source_readings,


                DEGREES(

                  ATAN2(
                    wind_sin,
                    wind_cos
                  )

                )

                AS wind_direction


              FROM
                daily

            ),


            final_data AS (

              SELECT

                temperature,

                humidity,

                pressure,

                wind_speed,

                rainy,

                source_readings,


                CASE

                  WHEN
                    wind_direction < 0

                  THEN
                    wind_direction + 360

                  ELSE
                    wind_direction

                END

                AS wind_direction,


                CASE

                  WHEN
                    humidity > 0

                  THEN

                    (
                      243.12 *

                      (
                        LN(
                          humidity /
                          100.0
                        )

                        +

                        (
                          17.62 *
                          temperature
                        )

                        /

                        (
                          243.12 +
                          temperature
                        )
                      )
                    )

                    /

                    (
                      17.62

                      -

                      (
                        LN(
                          humidity /
                          100.0
                        )

                        +

                        (
                          17.62 *
                          temperature
                        )

                        /

                        (
                          243.12 +
                          temperature
                        )
                      )
                    )

                  ELSE
                    NULL

                END

                AS dewpoint


              FROM
                calculated

            ),


            saved AS (

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

              SELECT

                ${device},

                ${date},

                ROUND(
                  temperature::numeric,
                  2
                ),

                ROUND(
                  humidity::numeric,
                  2
                ),

                ROUND(
                  dewpoint::numeric,
                  2
                ),

                ROUND(
                  pressure::numeric,
                  2
                ),

                ROUND(
                  wind_speed::numeric,
                  2
                ),

                ROUND(
                  wind_direction::numeric,
                  2
                ),

                CASE
                  WHEN rainy
                    THEN 0.2
                  ELSE 0
                END

              FROM
                final_data


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


              RETURNING 1

            )


            SELECT

              source_readings

            FROM
              final_data

          `;


        aiResults.push({

          success:
            true,

          device:
            device,

          date:
            date,

          sourceReadings:
            Number(
              result[0]
                ?.source_readings ||
              0
            )

        });


      } catch (
        error
      ) {

        aiResults.push({

          success:
            false,

          device:
            device,

          date:
            date,

          error:
            error.message

        });

      }

    }


    const aiCreated =
      aiResults.filter(
        x =>
          x.success
      ).length;


    const aiFailed =
      aiResults.filter(
        x =>
          !x.success
      ).length;


    // =========================================
    // Final response
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
            insertedCount,

          deleted:
            deletedCount

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
