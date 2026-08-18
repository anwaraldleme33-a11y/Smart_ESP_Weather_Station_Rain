import os
import json
import math
import pickle
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import numpy as np
import psycopg

ALLOWED_DEVICES = {"max1", "max2", "max3", "max4"}
RAIN_PROXY_MM = 0.2
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "ai_models")

DIRECTION_DEGREES = {
    "N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5,
    "E": 90.0, "ESE": 112.5, "SE": 135.0, "SSE": 157.5,
    "S": 180.0, "SSW": 202.5, "SW": 225.0, "WSW": 247.5,
    "W": 270.0, "WNW": 292.5, "NW": 315.0, "NNW": 337.5,
}

_MODEL_CACHE = None
_FEATURES = None
_MODEL_ERRORS = {}


def _json_safe(value):
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _direction_to_degrees(value):
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value) % 360.0
    text = str(value).strip().upper()
    if text in DIRECTION_DEGREES:
        return DIRECTION_DEGREES[text]
    try:
        return float(text) % 360.0
    except Exception:
        return 0.0


def _dewpoint_celsius(temp_c, humidity):
    humidity = min(100.0, max(1.0, float(humidity)))
    temp_c = float(temp_c)
    a = 17.625
    b = 243.04
    gamma = math.log(humidity / 100.0) + (a * temp_c) / (b + temp_c)
    return (b * gamma) / (a - gamma)


def _load_models():
    global _MODEL_CACHE, _FEATURES, _MODEL_ERRORS
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE, _FEATURES, _MODEL_ERRORS

    models = {}
    errors = {}
    feature_list = None

    for day in range(1, 8):
        day_dir = os.path.join(MODELS_DIR, f"day{day}")
        try:
            with open(os.path.join(day_dir, "features.pkl"), "rb") as f:
                features = pickle.load(f)
            if feature_list is None:
                feature_list = list(features)

            with open(os.path.join(day_dir, "classifier.pkl"), "rb") as f:
                classifier = pickle.load(f)
            with open(os.path.join(day_dir, "regressor.pkl"), "rb") as f:
                regressor = pickle.load(f)
            with open(os.path.join(day_dir, "threshold.pkl"), "rb") as f:
                threshold = float(pickle.load(f))

            models[day] = {
                "classifier": classifier,
                "regressor": regressor,
                "threshold": threshold,
                "features": list(features),
            }
        except Exception as exc:
            errors[day] = f"{type(exc).__name__}: {exc}"

    if feature_list is None:
        metadata_path = os.path.join(MODELS_DIR, "metadata.json")
        with open(metadata_path, "r", encoding="utf-8") as f:
            feature_list = json.load(f)["features"]

    _MODEL_CACHE = models
    _FEATURES = feature_list
    _MODEL_ERRORS = errors
    return models, feature_list, errors


def _fetch_daily_history(device):
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    query = """
    WITH combined AS (
      SELECT device_id, temperture, humidity, pressure,
             winds, windd, rainy, reading_date, time
      FROM weather_archive
      WHERE device_id = %s
        AND reading_date >= CURRENT_DATE - INTERVAL '45 days'

      UNION ALL

      SELECT device_id, temperture, humidity, pressure,
             winds, windd, rainy, reading_date, time
      FROM weather_data
      WHERE device_id = %s
        AND reading_date >= CURRENT_DATE - INTERVAL '45 days'
    )
    SELECT
      reading_date::date AS reading_date,
      AVG(temperture)::float8 AS temperature,
      AVG(humidity)::float8 AS humidity,
      AVG(pressure)::float8 AS pressure,
      AVG(winds)::float8 AS wind_speed,
      BOOL_OR(COALESCE(rainy, false)) AS rainy,
      (ARRAY_AGG(windd ORDER BY time DESC))[1] AS wind_direction
    FROM combined
    GROUP BY reading_date::date
    ORDER BY reading_date::date ASC;
    """

    conn = psycopg.connect(database_url, connect_timeout=8)
    try:
        with conn.cursor() as cur:
            cur.execute(query, (device, device))
            rows = cur.fetchall()
    finally:
        conn.close()

    history = []
    for row in rows:
        d, temp, hum, pressure, wind_speed, rainy, wind_dir = row
        if temp is None or hum is None or pressure is None or wind_speed is None:
            continue
        history.append({
            "date": d,
            "temperature": float(temp),
            "humidity": float(hum),
            "dewpoint": _dewpoint_celsius(float(temp), float(hum)),
            "pressure": float(pressure),
            "wind_speed": max(0.0, float(wind_speed)),
            "wind_direction": _direction_to_degrees(wind_dir),
            "rainfall": RAIN_PROXY_MM if bool(rainy) else 0.0,
        })
    return history


def _prepare_31_days(history):
    if not history:
        return None, True, 0

    by_date = {x["date"]: dict(x) for x in history}
    latest_date = max(by_date)
    latest = by_date[latest_date]
    real_days = len(by_date)
    bootstrapped = False
    result = []
    previous = None

    start = latest_date - timedelta(days=30)
    for i in range(31):
        d = start + timedelta(days=i)
        if d in by_date:
            row = dict(by_date[d])
            previous = row
        else:
            bootstrapped = True
            source = previous or latest
            row = dict(source)
            row["date"] = d
            # Missing calendar days are assumed dry rather than inventing rainfall.
            row["rainfall"] = 0.0
            previous = row
        result.append(row)

    return result, bootstrapped, real_days


def _mean(values):
    return float(sum(values) / len(values)) if values else 0.0


def _make_features(days, feature_names):
    current = days[-1]
    f = {}

    f["temperature"] = current["temperature"]
    f["dewpoint"] = current["dewpoint"]
    f["pressure"] = current["pressure"]
    f["wind_speed"] = current["wind_speed"]
    f["wind_direction"] = current["wind_direction"]
    f["rainfall"] = current["rainfall"]

    d = current["date"]
    day_of_year = d.timetuple().tm_yday
    f["year"] = float(d.year)
    f["month"] = float(d.month)
    f["day_of_year"] = float(day_of_year)
    f["day_of_week"] = float(d.weekday())
    f["month_sin"] = math.sin(2.0 * math.pi * d.month / 12.0)
    f["month_cos"] = math.cos(2.0 * math.pi * d.month / 12.0)
    f["doy_sin"] = math.sin(2.0 * math.pi * day_of_year / 365.25)
    f["doy_cos"] = math.cos(2.0 * math.pi * day_of_year / 365.25)

    radians = math.radians(current["wind_direction"])
    f["wind_dir_sin"] = math.sin(radians)
    f["wind_dir_cos"] = math.cos(radians)

    lags = [1, 2, 3, 5, 7, 14, 21, 30]
    for lag in lags:
        row = days[-1 - lag]
        f[f"rainfall_lag_{lag}"] = row["rainfall"]
        f[f"temperature_lag_{lag}"] = row["temperature"]
        f[f"dewpoint_lag_{lag}"] = row["dewpoint"]
        f[f"pressure_lag_{lag}"] = row["pressure"]
        f[f"wind_speed_lag_{lag}"] = row["wind_speed"]

    for window in [3, 7, 14, 30]:
        recent = days[-window:]
        rain = [x["rainfall"] for x in recent]
        f[f"rain_mean_{window}"] = _mean(rain)
        f[f"rain_sum_{window}"] = float(sum(rain))
        f[f"temp_mean_{window}"] = _mean([x["temperature"] for x in recent])
        f[f"pressure_mean_{window}"] = _mean([x["pressure"] for x in recent])
        f[f"wind_mean_{window}"] = _mean([x["wind_speed"] for x in recent])

    for lag in [1, 3, 6, 24]:
        f[f"pressure_change_{lag}"] = current["pressure"] - days[-1 - lag]["pressure"]
    for lag in [1, 3]:
        f[f"temperature_change_{lag}"] = current["temperature"] - days[-1 - lag]["temperature"]

    f["dewpoint_depression"] = current["temperature"] - current["dewpoint"]

    for window in [3, 7, 14]:
        recent = days[-window:]
        rainy_days = sum(1 for x in recent if x["rainfall"] >= RAIN_PROXY_MM)
        f[f"rain_frequency_{window}"] = float(rainy_days) / float(window)

    dry_days = 0
    for row in reversed(days):
        if row["rainfall"] >= RAIN_PROXY_MM:
            break
        dry_days += 1
    f["dry_days"] = float(dry_days)

    missing = [name for name in feature_names if name not in f]
    if missing:
        raise RuntimeError("Missing engineered features: " + ", ".join(missing))

    values = np.array([[float(f[name]) for name in feature_names]], dtype=np.float64)
    if not np.isfinite(values).all():
        raise RuntimeError("Feature matrix contains NaN or infinite values")
    return values


def _predict(device):
    history = _fetch_daily_history(device)
    days, bootstrapped, real_days = _prepare_31_days(history)

    if not days:
        return {
            "success": True,
            "device": device,
            "forecast7days": [],
            "historyDays": 0,
            "bootstrapped": True,
            "message": "لا توجد أي قراءة للمحطة حتى الآن"
        }

    models, feature_names, model_errors = _load_models()
    x = _make_features(days, feature_names)
    latest_date = days[-1]["date"]
    output = []

    for day in range(1, 8):
        future_date = latest_date + timedelta(days=day)
        if day not in models:
            output.append({
                "day": day,
                "date": future_date.isoformat(),
                "available": False,
                "error": model_errors.get(day, "Model unavailable")
            })
            continue

        model = models[day]
        try:
            classifier = model["classifier"]
            regressor = model["regressor"]
            threshold = float(model["threshold"])

            probability = float(classifier.predict_proba(x)[0][1])
            rain = bool(probability >= threshold)
            raw_amount = max(0.0, float(regressor.predict(x)[0]))
            amount = raw_amount if rain else 0.0

            output.append({
                "day": day,
                "date": future_date.isoformat(),
                "available": True,
                "rainProbability": round(probability * 100.0, 1),
                "threshold": round(threshold * 100.0, 1),
                "rain": rain,
                "rainfallMm": round(amount, 2),
                "rawRainfallMm": round(raw_amount, 2),
            })
        except Exception as exc:
            output.append({
                "day": day,
                "date": future_date.isoformat(),
                "available": False,
                "error": f"{type(exc).__name__}: {exc}"
            })

    return {
        "success": True,
        "device": device,
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "model": "Smart Weather AI 7-Day Rain Forecast",
        "featureCount": len(feature_names),
        "historyDays": real_days,
        "bootstrapped": bool(bootstrapped),
        "rainfallInputNote": "rainy=true is represented as 0.2 mm until a real rain gauge is added",
        "forecast7days": output,
    }


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, default=_json_safe).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        try:
            params = parse_qs(urlparse(self.path).query)
            device = params.get("device", [""])[0]
            if device not in ALLOWED_DEVICES:
                self._send_json(400, {"success": False, "error": "جهاز غير صالح"})
                return
            self._send_json(200, _predict(device))
        except Exception as exc:
            self._send_json(500, {
                "success": False,
                "error": "خطأ في تشغيل نموذج الذكاء الاصطناعي",
                "message": f"{type(exc).__name__}: {exc}"
            })
