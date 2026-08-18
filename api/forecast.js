import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const allowedDevices = ["max1", "max2", "max3", "max4"];

export default async function handler(req, res) {

  // ================= CORS =================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "طريقة غير مسموحة"
    });
  }

  try {

    const { device } = req.query;

    // ========================================
    // التحقق من المحطة
    // ========================================

    if (!allowedDevices.includes(device)) {
      return res.status(400).json({
        error: "جهاز غير صالح"
      });
    }

    // ========================================
    // جلب البيانات التاريخية
    // آخر 30 يوم
    // ========================================

    const archiveRows = await sql`

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

      AND reading_date >= CURRENT_DATE - INTERVAL '30 days'

      ORDER BY time ASC

    `;

    // ========================================
    // جلب بيانات اليوم الحالية
    // ========================================

    const currentRows = await sql`

      SELECT
        device_id,
        temperture,
        humidity,
        pressure,
        windS AS winds,
        windD AS windd,
        rainy,
        reading_date,
        time

      FROM weather_data

      WHERE device_id = ${device}

      ORDER BY time ASC

    `;

    // دمج البيانات
    const allRows = [
      ...archiveRows,
      ...currentRows
    ];

    if (allRows.length === 0) {

      return res.status(200).json({
        device: device,
        forecast24h: [],
        forecast7days: [],
        message: "لا توجد بيانات تاريخية كافية"
      });

    }

    // ========================================
    // تنظيف البيانات
    // ========================================

    const cleanRows = allRows
      .map(row => {

        const temperature = Number(row.temperture);
        const humidity = Number(row.humidity);
        const pressure = Number(row.pressure);
        const windSpeed = Number(row.winds);

        let rain = false;

        if (
          row.rainy === true ||
          row.rainy === 1 ||
          row.rainy === "1" ||
          row.rainy === "true"
        ) {
          rain = true;
        }

        const time = new Date(row.time);

        return {
          temperature: isNaN(temperature) ? null : temperature,
          humidity: isNaN(humidity) ? null : humidity,
          pressure: isNaN(pressure) ? null : pressure,
          windSpeed: isNaN(windSpeed) ? null : windSpeed,
          windDirection: row.windd || "غير معروف",
          rain: rain,
          date: row.reading_date,
          time: time
        };

      })
      .filter(row => !isNaN(row.time.getTime()));

    // ========================================
    // المتوسط
    // ========================================

    function average(values) {

      const valid = values.filter(
        value => value !== null &&
                 value !== undefined &&
                 !isNaN(value)
      );

      if (valid.length === 0) {
        return 0;
      }

      return valid.reduce(
        (sum, value) => sum + value,
        0
      ) / valid.length;
    }

    // ========================================
    // أقرب قيمة
    // ========================================

    function latestValue(field, fallback) {

      for (let i = cleanRows.length - 1; i >= 0; i--) {

        const value = cleanRows[i][field];

        if (
          value !== null &&
          value !== undefined &&
          !isNaN(value)
        ) {
          return value;
        }

      }

      return fallback;
    }

    // ========================================
    // آخر قراءة
    // ========================================

    const latest = cleanRows[cleanRows.length - 1];

    const baseTemperature =
      latestValue(
        "temperature",
        average(cleanRows.map(x => x.temperature))
      );

    const baseHumidity =
      latestValue(
        "humidity",
        average(cleanRows.map(x => x.humidity))
      );

    const basePressure =
      latestValue(
        "pressure",
        average(cleanRows.map(x => x.pressure))
      );

    const baseWindSpeed =
      latestValue(
        "windSpeed",
        average(cleanRows.map(x => x.windSpeed))
      );

    // ========================================
    // حساب الاتجاه الأكثر تكراراً
    // ========================================

    function mostCommonDirection(rows) {

      const count = {};

      rows.forEach(row => {

        if (!row.windDirection) return;

        const direction =
          String(row.windDirection).trim();

        if (!direction) return;

        count[direction] =
          (count[direction] || 0) + 1;

      });

      let best = "غير معروف";
      let max = 0;

      Object.keys(count).forEach(direction => {

        if (count[direction] > max) {

          max = count[direction];
          best = direction;

        }

      });

      return best;
    }

    const baseWindDirection =
      mostCommonDirection(
        cleanRows.slice(-100)
      );

    // ========================================
    // احتمال المطر
    // ========================================

    const rainRows =
      cleanRows.slice(-100);

    const rainyCount =
      rainRows.filter(x => x.rain).length;

    let baseRainProbability = 0;

    if (rainRows.length > 0) {

      baseRainProbability =
        (rainyCount / rainRows.length) * 100;

    }

    // ========================================
    // حساب الاتجاه العام للتغير
    // ========================================

    function calculateTrend(field) {

      const rows =
        cleanRows
          .filter(x =>
            x[field] !== null &&
            !isNaN(x[field])
          )
          .slice(-50);

      if (rows.length < 5) {
        return 0;
      }

      const first =
        Number(rows[0][field]);

      const last =
        Number(rows[rows.length - 1][field]);

      const trend =
        (last - first) / rows.length;

      return trend;
    }

    const temperatureTrend =
      calculateTrend("temperature");

    const humidityTrend =
      calculateTrend("humidity");

    const pressureTrend =
      calculateTrend("pressure");

    const windTrend =
      calculateTrend("windSpeed");

    // ========================================
    // متوسط حسب ساعة اليوم
    // ========================================

    function hourlyAverage(hour, field) {

      const values = [];

      cleanRows.forEach(row => {

        if (
          row.time.getUTCHours() === hour &&
          row[field] !== null &&
          !isNaN(row[field])
        ) {

          values.push(
            Number(row[field])
          );

        }

      });

      return average(values);

    }

    // ========================================
    // تنبؤ 24 ساعة
    // ========================================

    const forecast24h = [];

    const now = new Date();

    for (let i = 1; i <= 24; i++) {

      const future =
        new Date(
          now.getTime() +
          i * 60 * 60 * 1000
        );

      const hour =
        future.getUTCHours();

      const historicalTemp =
        hourlyAverage(
          hour,
          "temperature"
        );

      const historicalHumidity =
        hourlyAverage(
          hour,
          "humidity"
        );

      const historicalPressure =
        hourlyAverage(
          hour,
          "pressure"
        );

      const historicalWind =
        hourlyAverage(
          hour,
          "windSpeed"
        );

      let temperature =
        historicalTemp ||
        baseTemperature;

      let humidity =
        historicalHumidity ||
        baseHumidity;

      let pressure =
        historicalPressure ||
        basePressure;

      let windSpeed =
        historicalWind ||
        baseWindSpeed;

      // تطبيق الاتجاه العام
      temperature +=
        temperatureTrend * Math.min(i, 6);

      humidity +=
        humidityTrend * Math.min(i, 6);

      pressure +=
        pressureTrend * Math.min(i, 6);

      windSpeed +=
        windTrend * Math.min(i, 6);

      // حدود منطقية
      humidity =
        Math.max(
          0,
          Math.min(100, humidity)
        );

      windSpeed =
        Math.max(0, windSpeed);

      // احتمال المطر
      let rainProbability =
        baseRainProbability;

      // زيادة بسيطة إذا كانت الرطوبة عالية
      if (humidity >= 80) {
        rainProbability += 15;
      }

      if (humidity >= 90) {
        rainProbability += 10;
      }

      rainProbability =
        Math.max(
          0,
          Math.min(100, rainProbability)
        );

      forecast24h.push({

        time: future.toISOString(),

        temperature:
          Number(temperature.toFixed(1)),

        humidity:
          Number(humidity.toFixed(1)),

        pressure:
          Number(pressure.toFixed(1)),

        windSpeed:
          Number(windSpeed.toFixed(1)),

        windDirection:
          baseWindDirection,

        rainProbability:
          Number(rainProbability.toFixed(1))

      });

    }

    // ========================================
    // التنبؤ لمدة 7 أيام
    // ========================================

    function dailyData(date) {

      const dateString =
        date.toISOString().split("T")[0];

      return cleanRows.filter(row =>
        row.date === dateString
      );

    }

    const forecast7days = [];

    for (let day = 1; day <= 7; day++) {

      const futureDate =
        new Date(
          now.getTime() +
          day * 24 * 60 * 60 * 1000
        );

      const dayOfWeek =
        futureDate.getUTCDay();

      // بيانات نفس يوم الأسبوع
      const sameWeekday =
        cleanRows.filter(row => {

          return row.time.getUTCDay() === dayOfWeek;

        });

      const source =
        sameWeekday.length > 0
          ? sameWeekday.slice(-100)
          : cleanRows.slice(-100);

      const temperatures =
        source.map(x => x.temperature);

      const humidities =
        source.map(x => x.humidity);

      const pressures =
        source.map(x => x.pressure);

      const windSpeeds =
        source.map(x => x.windSpeed);

      const temp =
        average(temperatures) ||
        baseTemperature;

      const humidity =
        average(humidities) ||
        baseHumidity;

      const pressure =
        average(pressures) ||
        basePressure;

      const windSpeed =
        average(windSpeeds) ||
        baseWindSpeed;

      const rainTotal =
        source.length > 0
          ? source.filter(x => x.rain).length /
            source.length *
            100
          : baseRainProbability;

      const direction =
        mostCommonDirection(source);

      forecast7days.push({

        date:
          futureDate
            .toISOString()
            .split("T")[0],

        temperature:
          Number(
            (
              temp +
              temperatureTrend *
              Math.min(day, 3)
            ).toFixed(1)
          ),

        humidity:
          Number(
            Math.max(
              0,
              Math.min(
                100,
                humidity +
                humidityTrend *
                Math.min(day, 3)
              )
            ).toFixed(1)
          ),

        pressure:
          Number(
            (
              pressure +
              pressureTrend *
              Math.min(day, 3)
            ).toFixed(1)
          ),

        windSpeed:
          Number(
            Math.max(
              0,
              windSpeed +
              windTrend *
              Math.min(day, 3)
            ).toFixed(1)
          ),

        windDirection:
          direction || baseWindDirection,

        rainProbability:
          Number(
            Math.max(
              0,
              Math.min(100, rainTotal)
            ).toFixed(1)
          )

      });

    }

    // ========================================
    // النتيجة
    // ========================================

    return res.status(200).json({

      success: true,

      device: device,

      generatedAt:
        new Date().toISOString(),

      model:
        "Historical Weather Forecast",

      forecast24h:
        forecast24h,

      forecast7days:
        forecast7days

    });

  } catch (error) {

    console.error(
      "Forecast Error:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "خطأ في إنشاء التنبؤ",

      message:
        error.message

    });

  }

}
