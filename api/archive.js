import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const allowedDevices = [
  "max1",
  "max2",
  "max3",
  "max4"
];

export default async function handler(req, res) {

  // السماح بالتشغيل من Vercel Cron
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "طريقة غير مسموحة"
    });
  }

  try {

    // ==============================
    // حساب الوقت بتوقيت بغداد
    // ==============================

    const now = new Date();

    const baghdadTime = new Date(
      now.getTime() + (3 * 60 * 60 * 1000)
    );

    // نريد أرشفة بيانات الأمس
    const archiveDate = new Date(baghdadTime);

    archiveDate.setDate(
      archiveDate.getDate() - 1
    );

    const archiveDateStr =
      archiveDate.toISOString().split("T")[0];


    let results = [];


    // ==============================
    // أرشفة كل محطة
    // ==============================

    for (const device of allowedDevices) {

      // معرفة عدد البيانات الموجودة
      const countResult = await sql`

        SELECT COUNT(*)::int AS count

        FROM weather_data

        WHERE device_id = ${device}

        AND reading_date = ${archiveDateStr}

      `;

      const rowCount = countResult[0].count;


      // إذا لم توجد بيانات
      if (rowCount === 0) {

        results.push({
          device: device,
          archived: 0,
          message: "لا توجد بيانات"
        });

        continue;
      }


      // ==============================
      // نقل البيانات إلى الأرشيف
      // ==============================

      await sql`

        INSERT INTO weather_archive
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
          windS,
          windD,
          rainy,
          reading_date,
          time

        FROM weather_data

        WHERE device_id = ${device}

        AND reading_date = ${archiveDateStr}

      `;


      // ==============================
      // حذف البيانات بعد نجاح النقل
      // ==============================

      await sql`

        DELETE FROM weather_data

        WHERE device_id = ${device}

        AND reading_date = ${archiveDateStr}

      `;


      results.push({

        device: device,

        archived: rowCount,

        message: "تمت الأرشفة بنجاح"

      });

    }


    return res.status(200).json({

      success: true,

      archive_date: archiveDateStr,

      results: results

    });

  } catch (error) {

    console.error(
      "Archive error:",
      error
    );

    return res.status(500).json({

      success: false,

      error: error.message

    });

  }
}
