import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sql = neon(process.env.DATABASE_URL);

const allowedDevices =
  new Set([
    "max1",
    "max2",
    "max3",
    "max4"
  ]);

const RAIN_PROXY_MM = 0.2;

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const MODELS_DIR =
  path.join(
    __dirname,
    "..",
    "ai_models_json"
  );


// =========================================
// Wind directions
// =========================================

const DIRECTION_DEGREES = {

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


// =========================================
// Model cache
// =========================================

let modelCache = null;


// =========================================
// Read JSON
// =========================================

function readJSON(file) {

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );

}


// =========================================
// Load models
// =========================================

function loadModels() {

  if (modelCache) {

    return modelCache;

  }


  const config =
    readJSON(
      path.join(
        MODELS_DIR,
        "config.json"
      )
    );


  const days = {};


  for (
    let day = 1;
    day <= 7;
    day++
  ) {

    const dir =
      path.join(
        MODELS_DIR,
        `day${day}`
      );


    const classifierPath =
      path.join(
        dir,
        "classifier.json"
      );


    const regressorPath =
      path.join(
        dir,
        "regressor.json"
      );


    days[day] = {

      threshold:
        Number(
          config.thresholds[
            String(day)
          ]
        ),

      classifier:
        fs.existsSync(
          classifierPath
        )
          ? readJSON(
              classifierPath
            )
          : null,

      regressor:
        fs.existsSync(
          regressorPath
        )
          ? readJSON(
              regressorPath
            )
          : null,

      classifierType:
        config.model_types[
          `day${day}_classifier`
        ],

      regressorType:
        config.model_types[
          `day${day}_regressor`
        ]

    };

  }


  modelCache = {

    features:
      config.features,

    days

  };


  return modelCache;

}


// =========================================
// Sigmoid
// =========================================

function sigmoid(x) {

  if (x >= 0) {

    const z =
      Math.exp(-x);

    return (
      1 /
      (1 + z)
    );

  }


  const z =
    Math.exp(x);


  return (
    z /
    (1 + z)
  );

}


// =========================================
// CatBoost JSON runtime
// =========================================

function catBoostRaw(
  model,
  x
) {

  let sum = 0;


  for (
    const tree
    of model.oblivious_trees
  ) {

    let leafIndex = 0;


    for (
      let depth = 0;
      depth < tree.splits.length;
      depth++
    ) {

      const split =
        tree.splits[
          depth
        ];


      if (
        x[
          split.float_feature_index
        ] >
        split.border
      ) {

        leafIndex |=
          (
            1 << depth
          );

      }

    }


    sum +=
      tree.leaf_values[
        leafIndex
      ];

  }


  const scaleBias =
    model.scale_and_bias ||
    [
      1,
      [0]
    ];


  const scale =
    Number(
      scaleBias[0] ?? 1
    );


  const biasRaw =
    Array.isArray(
      scaleBias[1]
    )
      ? scaleBias[1][0]
      : scaleBias[1];


  const bias =
    Number(
      biasRaw ?? 0
    );


  return (
    sum * scale +
    bias
  );

}


// =========================================
// XGBoost JSON runtime
// =========================================

function xgBoostRaw(
  model,
  x
) {

  const learner =
    model.learner;


  const trees =
    learner
      .gradient_booster
      .model
      .trees;


  let sum = 0;


  for (
    const tree
    of trees
  ) {

    let node = 0;


    while (
      tree.left_children[
        node
      ] !== -1
    ) {

      const featureIndex =
        tree.split_indices[
          node
        ];


      const threshold =
        tree.split_conditions[
          node
        ];


      const value =
        x[
          featureIndex
        ];


      if (
        Number.isNaN(
          value
        )
      ) {

        node =
          tree.default_left[
            node
          ]
            ? tree.left_children[
                node
              ]
            : tree.right_children[
                node
              ];

      } else if (
        value <
        threshold
      ) {

        node =
          tree.left_children[
            node
          ];

      } else {

        node =
          tree.right_children[
            node
          ];

      }

    }


    sum +=
      tree.split_conditions[
        node
      ];

  }


  let baseScoreText =
    String(
      learner
        .learner_model_param
        .base_score ||
      "0"
    )
      .replace(
        /[\[\]]/g,
        ""
      );


  let baseScore =
    Number(
      baseScoreText
    );


  if (
    baseScore > 0 &&
    baseScore < 1
  ) {

    baseScore =
      Math.log(
        baseScore /
        (
          1 -
          baseScore
        )
      );

  }


  return (
    sum +
    baseScore
  );

}


// =========================================
// LightGBM compact JSON runtime
// =========================================

function lightGBMCompactRaw(
  model,
  x
) {

  function evalNode(
    node
  ) {

    // Leaf node
    if (
      node[0] === 0
    ) {

      return Number(
        node[1]
      );

    }


    const featureIndex =
      node[1];


    const threshold =
      Number(
        node[2]
      );


    const decisionType =
      node[3];


    const defaultLeft =
      node[4] === 1;


    const leftChild =
      node[5];


    const rightChild =
      node[6];


    const value =
      Number(
        x[
          featureIndex
        ]
      );


    // Missing value
    if (
      !Number.isFinite(
        value
      )
    ) {

      return evalNode(

        defaultLeft
          ? leftChild
          : rightChild

      );

    }


    let goLeft =
      false;


    if (
      decisionType === "<="
    ) {

      goLeft =
        value <=
        threshold;

    } else if (
      decisionType === "<"
    ) {

      goLeft =
        value <
        threshold;

    } else {

      throw new Error(
        "Unsupported LightGBM decision type: " +
        decisionType
      );

    }


    return evalNode(

      goLeft
        ? leftChild
        : rightChild

    );

  }


  let rawScore = 0;


  for (
    const tree
    of model.trees
  ) {

    rawScore +=
      evalNode(
        tree
      );

  }


  return rawScore;

}


// =========================================
// Run model
// =========================================

function modelRaw(
  model,
  type,
  x
) {

  if (
    type ===
    "catboost"
  ) {

    return catBoostRaw(
      model,
      x
    );

  }


  if (
    type ===
    "xgboost"
  ) {

    return xgBoostRaw(
      model,
      x
    );

  }


  if (
    type ===
    "lightgbm_compact"
  ) {

    return lightGBMCompactRaw(
      model,
      x
    );

  }


  throw new Error(
    `Unsupported model type: ${type}`
  );

}


// =========================================
// Wind direction to degree
// =========================================

function directionToDegrees(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return 0;

  }


  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    )
  ) {

    return (
      (
        value % 360
      ) +
      360
    ) % 360;

  }


  const text =
    String(
      value
    )
      .trim()
      .toUpperCase();


  if (
    text in
    DIRECTION_DEGREES
  ) {

    return (
      DIRECTION_DEGREES[
        text
      ]
    );

  }


  const n =
    Number(
      text
    );


  return Number.isFinite(
    n
  )
    ? (
        (
          n % 360
        ) +
        360
      ) % 360
    : 0;

}


// =========================================
// Dew point
// =========================================

function dewpointCelsius(
  tempC,
  humidity
) {

  const rh =
    Math.min(
      100,
      Math.max(
        1,
        Number(
          humidity
        )
      )
    );


  const t =
    Number(
      tempC
    );


  const a =
    17.625;


  const b =
    243.04;


  const gamma =
    Math.log(
      rh / 100
    ) +
    (
      a * t
    ) /
    (
      b + t
    );


  return (
    b * gamma
  ) /
  (
    a - gamma
  );

}


// =========================================
// Date helpers
// =========================================

function dateOnlyUTC(
  value
) {

  if (
    value instanceof Date
  ) {

    return value
      .toISOString()
      .slice(
        0,
        10
      );

  }


  return String(
    value
  ).slice(
    0,
    10
  );

}


function parseDateUTC(
  iso
) {

  return new Date(
    `${iso}T00:00:00Z`
  );

}


function addDaysISO(
  iso,
  n
) {

  const d =
    parseDateUTC(
      iso
    );


  d.setUTCDate(
    d.getUTCDate() +
    n
  );


  return d
    .toISOString()
    .slice(
      0,
      10
    );

}


function dayOfYear(
  iso
) {

  const d =
    parseDateUTC(
      iso
    );


  const start =
    Date.UTC(
      d.getUTCFullYear(),
      0,
      0
    );


  return Math.floor(
    (
      d.getTime() -
      start
    ) /
    86400000
  );

}


// =========================================
// Aggregate current raw readings
// =========================================

function aggregateDaily(
  rows
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const iso =
      dateOnlyUTC(
        row.reading_date
      );


    if (
      !iso ||
      iso.length < 10
    ) {

      continue;

    }


    if (
      !groups.has(
        iso
      )
    ) {

      groups.set(
        iso,
        []
      );

    }


    groups
      .get(
        iso
      )
      .push(
        row
      );

  }


  const result =
    [];


  for (
    const [
      iso,
      dayRows
    ]
    of [
      ...groups.entries()
    ].sort(
      (
        a,
        b
      ) =>
        a[0]
          .localeCompare(
            b[0]
          )
    )
  ) {

    const valid =
      dayRows
        .map(
          r => ({

            temperature:
              Number(
                r.temperture
              ),

            humidity:
              Number(
                r.humidity
              ),

            pressure:
              Number(
                r.pressure
              ),

            windSpeed:
              Number(
                r.winds
              ),

            windDirection:
              r.windd,

            rainy:
              r.rainy === true ||
              r.rainy === 1 ||
              r.rainy === "1" ||
              String(
                r.rainy
              )
                .toLowerCase() ===
                "true",

            time:
              new Date(
                r.time
              )
                .getTime()

          })
        )
        .filter(
          r =>
            Number.isFinite(
              r.temperature
            ) &&
            Number.isFinite(
              r.humidity
            ) &&
            Number.isFinite(
              r.pressure
            ) &&
            Number.isFinite(
              r.windSpeed
            )
        );


    if (
      !valid.length
    ) {

      continue;

    }


    const avg =
      key =>
        valid.reduce(
          (
            sum,
            row
          ) =>
            sum +
            row[key],
          0
        ) /
        valid.length;


    const latest =
      [
        ...valid
      ]
        .sort(
          (
            a,
            b
          ) =>
            b.time -
            a.time
        )[0];


    const temperature =
      avg(
        "temperature"
      );


    const humidity =
      avg(
        "humidity"
      );


    result.push({

      date:
        iso,

      temperature:
        temperature,

      humidity:
        humidity,

      dewpoint:
        dewpointCelsius(
          temperature,
          humidity
        ),

      pressure:
        avg(
          "pressure"
        ),

      wind_speed:
        Math.max(
          0,
          avg(
            "windSpeed"
          )
        ),

      wind_direction:
        directionToDegrees(
          latest.windDirection
        ),

      rainfall:
        valid.some(
          r =>
            r.rainy
        )
          ? RAIN_PROXY_MM
          : 0

    });

  }


  return result;

}


// =========================================
// Prepare 31 days
// =========================================

function prepare31Days(
  history
) {

  if (
    !history.length
  ) {

    return {

      days:
        null,

      bootstrapped:
        true,

      realDays:
        0

    };

  }


  const byDate =
    new Map(
      history.map(
        x => [
          x.date,
          {
            ...x
          }
        ]
      )
    );


  const latestDate =
    [
      ...byDate.keys()
    ]
      .sort()
      .at(-1);


  const latest =
    byDate.get(
      latestDate
    );


  const result =
    [];


  let previous =
    null;


  let bootstrapped =
    false;


  for (
    let i = -30;
    i <= 0;
    i++
  ) {

    const iso =
      addDaysISO(
        latestDate,
        i
      );


    let row;


    if (
      byDate.has(
        iso
      )
    ) {

      row = {
        ...byDate.get(
          iso
        )
      };


      previous =
        row;

    } else {

      bootstrapped =
        true;


      row = {

        ...(
          previous ||
          latest
        ),

        date:
          iso,

        rainfall:
          0

      };


      previous =
        row;

    }


    result.push(
      row
    );

  }


  return {

    days:
      result,

    bootstrapped:
      bootstrapped,

    realDays:
      byDate.size

  };

}


// =========================================
// Mean
// =========================================

function mean(
  values
) {

  return values.length
    ? values.reduce(
        (
          a,
          b
        ) =>
          a + b,
        0
      ) /
      values.length
    : 0;

}


// =========================================
// Create 87 Features
// =========================================

function makeFeatures(
  days,
  featureNames
) {

  const current =
    days.at(-1);


  const f = {};


  f.temperature =
    current.temperature;


  f.dewpoint =
    current.dewpoint;


  f.pressure =
    current.pressure;


  f.wind_speed =
    current.wind_speed;


  f.wind_direction =
    current.wind_direction;


  f.rainfall =
    current.rainfall;


  const d =
    parseDateUTC(
      current.date
    );


  const doy =
    dayOfYear(
      current.date
    );


  f.year =
    d.getUTCFullYear();


  f.month =
    d.getUTCMonth() +
    1;


  f.day_of_year =
    doy;


  f.day_of_week =
    (
      d.getUTCDay() +
      6
    ) % 7;


  f.month_sin =
    Math.sin(
      2 *
      Math.PI *
      f.month /
      12
    );


  f.month_cos =
    Math.cos(
      2 *
      Math.PI *
      f.month /
      12
    );


  f.doy_sin =
    Math.sin(
      2 *
      Math.PI *
      doy /
      365.25
    );


  f.doy_cos =
    Math.cos(
      2 *
      Math.PI *
      doy /
      365.25
    );


  const rad =
    current.wind_direction *
    Math.PI /
    180;


  f.wind_dir_sin =
    Math.sin(
      rad
    );


  f.wind_dir_cos =
    Math.cos(
      rad
    );


  const lags =
    [
      1,
      2,
      3,
      5,
      7,
      14,
      21,
      30
    ];


  for (
    const lag
    of lags
  ) {

    const row =
      days[
        days.length -
        1 -
        lag
      ];


    f[
      `rainfall_lag_${lag}`
    ] =
      row.rainfall;


    f[
      `temperature_lag_${lag}`
    ] =
      row.temperature;


    f[
      `dewpoint_lag_${lag}`
    ] =
      row.dewpoint;


    f[
      `pressure_lag_${lag}`
    ] =
      row.pressure;


    f[
      `wind_speed_lag_${lag}`
    ] =
      row.wind_speed;

  }


  for (
    const window
    of [
      3,
      7,
      14,
      30
    ]
  ) {

    const recent =
      days.slice(
        -window
      );


    const rain =
      recent.map(
        x =>
          x.rainfall
      );


    f[
      `rain_mean_${window}`
    ] =
      mean(
        rain
      );


    f[
      `rain_sum_${window}`
    ] =
      rain.reduce(
        (
          a,
          b
        ) =>
          a + b,
        0
      );


    f[
      `temp_mean_${window}`
    ] =
      mean(
        recent.map(
          x =>
            x.temperature
        )
      );


    f[
      `pressure_mean_${window}`
    ] =
      mean(
        recent.map(
          x =>
            x.pressure
        )
      );


    f[
      `wind_mean_${window}`
    ] =
      mean(
        recent.map(
          x =>
            x.wind_speed
        )
      );

  }


  for (
    const lag
    of [
      1,
      3,
      6,
      24
    ]
  ) {

    f[
      `pressure_change_${lag}`
    ] =
      current.pressure -
      days[
        days.length -
        1 -
        lag
      ].pressure;

  }


  for (
    const lag
    of [
      1,
      3
    ]
  ) {

    f[
      `temperature_change_${lag}`
    ] =
      current.temperature -
      days[
        days.length -
        1 -
        lag
      ].temperature;

  }


  f.dewpoint_depression =
    current.temperature -
    current.dewpoint;


  for (
    const window
    of [
      3,
      7,
      14
    ]
  ) {

    const recent =
      days.slice(
        -window
      );


    f[
      `rain_frequency_${window}`
    ] =
      recent.filter(
        x =>
          x.rainfall >=
          RAIN_PROXY_MM
      ).length /
      window;

  }


  let dryDays =
    0;


  for (
    let i =
      days.length - 1;

    i >= 0;

    i--
  ) {

    if (
      days[i].rainfall >=
      RAIN_PROXY_MM
    ) {

      break;

    }


    dryDays++;

  }


  f.dry_days =
    dryDays;


  const x =
    featureNames.map(
      name =>
        Number(
          f[name]
        )
    );


  const bad =
    featureNames.filter(
      (
        name,
        i
      ) =>
        !Number.isFinite(
          x[i]
        )
    );


  if (
    bad.length
  ) {

    throw new Error(
      `Invalid/missing features: ${bad.join(", ")}`
    );

  }


  return x;

}


// =========================================
// Fetch AI history
//
// Previous days:
// ai_weather_archive
//
// Current day:
// weather_data
// =========================================

async function fetchHistory(
  device
) {

  // =========================================
  // Baghdad current date
  // =========================================

  const baghdadTodayResult =
    await sql`

      SELECT
        (
          NOW()
          AT TIME ZONE
          'Asia/Baghdad'
        )::date
        AS today

    `;


  const baghdadToday =
    dateOnlyUTC(
      baghdadTodayResult[
        0
      ].today
    );


  // =========================================
  // 1. Previous daily AI archive
  // =========================================

  const archiveDays =
    await sql`

      SELECT

        device_id,

        reading_date,

        temperature,

        humidity,

        dewpoint,

        pressure,

        wind_speed,

        wind_direction,

        rainfall

      FROM
        ai_weather_archive

      WHERE
        device_id =
        ${device}

      AND
        reading_date >=
        (
          (
            NOW()
            AT TIME ZONE
            'Asia/Baghdad'
          )::date
          -
          INTERVAL '45 days'
        )

      AND
        reading_date <
        (
          NOW()
          AT TIME ZONE
          'Asia/Baghdad'
        )::date

      ORDER BY
        reading_date
        ASC

    `;


  // =========================================
  // 2. Convert AI archive rows
  // =========================================

  const history =
    archiveDays
      .map(
        row => {

          const temperature =
            Number(
              row.temperature
            );


          const humidity =
            Number(
              row.humidity
            );


          const dewpoint =
            Number(
              row.dewpoint
            );


          const pressure =
            Number(
              row.pressure
            );


          const windSpeed =
            Number(
              row.wind_speed
            );


          const windDirection =
            Number(
              row.wind_direction
            );


          const rainfall =
            Number(
              row.rainfall
            );


          if (
            !Number.isFinite(
              temperature
            ) ||
            !Number.isFinite(
              humidity
            ) ||
            !Number.isFinite(
              dewpoint
            ) ||
            !Number.isFinite(
              pressure
            ) ||
            !Number.isFinite(
              windSpeed
            ) ||
            !Number.isFinite(
              windDirection
            ) ||
            !Number.isFinite(
              rainfall
            )
          ) {

            return null;

          }


          return {

            date:
              dateOnlyUTC(
                row.reading_date
              ),

            temperature:
              temperature,

            humidity:
              humidity,

            dewpoint:
              dewpoint,

            pressure:
              pressure,

            wind_speed:
              Math.max(
                0,
                windSpeed
              ),

            wind_direction:
              directionToDegrees(
                windDirection
              ),

            rainfall:
              Math.max(
                0,
                rainfall
              )

          };

        }
      )
      .filter(
        Boolean
      );


  // =========================================
  // 3. Current raw station readings
  // =========================================

  const currentRows =
    await sql`

      SELECT

        device_id,

        temperture,

        humidity,

        pressure,

        windS
          AS winds,

        windD
          AS windd,

        rainy,

        reading_date,

        time

      FROM
        weather_data

      WHERE
        device_id =
        ${device}

      AND
        reading_date =
        (
          NOW()
          AT TIME ZONE
          'Asia/Baghdad'
        )::date

      ORDER BY
        time
        ASC

    `;


  // =========================================
  // 4. Aggregate current day
  // =========================================

  const currentDaily =
    aggregateDaily(
      currentRows
    );


  // =========================================
  // 5. Combine archive + current day
  // =========================================

  const combined = [

    ...history,

    ...currentDaily

  ];


  // =========================================
  // 6. Remove duplicate dates
  // =========================================

  const byDate =
    new Map();


  for (
    const row
    of combined
  ) {

    byDate.set(
      row.date,
      row
    );

  }


  // =========================================
  // 7. Sort by date
  // =========================================

  const result =
    Array
      .from(
        byDate.values()
      )
      .sort(
        (
          a,
          b
        ) =>
          a.date.localeCompare(
            b.date
          )
      );


  return result;

}


// =========================================
// API handler
// =========================================

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

        error:
          "طريقة غير مسموحة"

      });

  }


  try {

    const {
      device
    } =
      req.query;


    if (
      !allowedDevices.has(
        device
      )
    ) {

      return res
        .status(400)
        .json({

          error:
            "جهاز غير صالح"

        });

    }


    // =========================================
    // Get daily history
    // =========================================

    const history =
      await fetchHistory(
        device
      );


    // =========================================
    // Prepare 31 days
    // =========================================

    const {

      days,

      bootstrapped,

      realDays

    } =
      prepare31Days(
        history
      );


    if (
      !days
    ) {

      return res
        .status(200)
        .json({

          success:
            true,

          device:
            device,

          forecast7days:
            [],

          historyDays:
            0,

          bootstrapped:
            true,

          message:
            "لا توجد أي قراءة للمحطة حتى الآن"

        });

    }


    // =========================================
    // Load models
    // =========================================

    const {

      features,

      days:
        models

    } =
      loadModels();


    // =========================================
    // Build 87 features
    // =========================================

    const x =
      makeFeatures(
        days,
        features
      );


    const latestDate =
      days.at(-1)
        .date;


    const forecast7days =
      [];


    // =========================================
    // Forecast Day 1 -> Day 7
    // =========================================

    for (
      let day = 1;
      day <= 7;
      day++
    ) {

      const futureDate =
        addDaysISO(
          latestDate,
          day
        );


      const m =
        models[
          day
        ];


      if (
        !m.classifier ||
        !m.regressor
      ) {

        forecast7days.push({

          day:
            day,

          date:
            futureDate,

          available:
            false,

          error:
            day === 4
              ? "Day 4 classifier source model is unavailable"
              : "Model unavailable"

        });


        continue;

      }


      try {

        // =========================================
        // Rain classifier
        // =========================================

        const classRaw =
          modelRaw(

            m.classifier,

            m.classifierType,

            x

          );


        const probability =
          sigmoid(
            classRaw
          );


        const rain =
          probability >=
          m.threshold;


        // =========================================
        // Rain amount regressor
        // =========================================

        const rawAmount =
          Math.max(
            0,
            modelRaw(

              m.regressor,

              m.regressorType,

              x

            )
          );


        // =========================================
        // Result
        // =========================================

        forecast7days.push({

          day:
            day,

          date:
            futureDate,

          available:
            true,

          rainProbability:
            Math.round(
              probability *
              1000
            ) / 10,

          threshold:
            Math.round(
              m.threshold *
              1000
            ) / 10,

          rain:
            rain,

          rainfallMm:
            rain
              ? (
                  Math.round(
                    rawAmount *
                    100
                  ) /
                  100
                )
              : 0,

          rawRainfallMm:
            Math.round(
              rawAmount *
              100
            ) / 100

        });

      } catch (
        error
      ) {

        forecast7days.push({

          day:
            day,

          date:
            futureDate,

          available:
            false,

          error:
            error.message

        });

      }

    }


    // =========================================
    // API response
    // =========================================

    return res
      .status(200)
      .json({

        success:
          true,

        device:
          device,

        generatedAt:
          new Date()
            .toISOString(),

        model:
          "Smart Weather AI 7-Day Rain Forecast (JSON runtime)",

        featureCount:
          features.length,

        historyDays:
          realDays,

        bootstrapped:
          bootstrapped,

        rainfallInputNote:
          "rainy=true is represented as 0.2 mm until a real rain gauge is added",

        forecast7days:
          forecast7days

      });


  } catch (
    error
  ) {

    console.error(
      "AI forecast error:",
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
