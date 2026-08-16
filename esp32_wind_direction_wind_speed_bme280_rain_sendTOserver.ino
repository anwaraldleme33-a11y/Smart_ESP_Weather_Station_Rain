//Weather station

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// ================= BME280 =================
#define SDA_PIN 21
#define SCL_PIN 22
#define BME_ADDR 0x76

Adafruit_BME280 bme;

// ================= WIND ===================
#define WIND_DIR_PIN 39
#define WIND_SPEED_PIN 36

float minVoltage = 0.4;
float maxVoltage = 3.0;
float maxSpeed   = 30.0;

// ================= RAIN SENSOR =================
#define RAIN_PIN 16

// ================= WIFI ===================
const char* WIFI_SSID = "Poco";
const char* WIFI_PASS = "12345678aa";

// ================= SERVER =================
const char* serverUrl =
"https://smart-esp-weather-station-rain.vercel.app/api/sensor";

// ================= DEVICE =================
String dn = "max1";

// ================= GLOBAL =================
float g_temperture = 0;
float g_humidity   = 0;
float g_pressure   = 0;
float g_windS      = 0;

String g_windD = "N";
String g_rain  = "not rainy";

// ================= TIMING =================
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 2000;

// ================= WIND DIR ===============
String getWindDirection(int adc) {

  if (adc < 400) return "N";
  else if (adc < 900) return "NE";
  else if (adc < 1400) return "E";
  else if (adc < 1900) return "SE";
  else if (adc < 2400) return "S";
  else if (adc < 2900) return "SW";
  else if (adc < 3400) return "W";
  else return "NW";
}

// ================= SETUP ==================
void setup() {

  Serial.begin(115200);

  // ===== Rain Sensor =====
  pinMode(RAIN_PIN, INPUT);

  // ===== WiFi =====
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println("\n✅ WiFi OK");
  Serial.println(WiFi.localIP());

  // ===== BME280 =====
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!bme.begin(BME_ADDR)) {

    Serial.println("❌ BME280 not found");

    while (1);
  }

  // ===== ADC =====
  analogReadResolution(12);

  analogSetPinAttenuation(WIND_DIR_PIN, ADC_11db);
  analogSetPinAttenuation(WIND_SPEED_PIN, ADC_11db);
}

// ================= LOOP ===================
void loop() {

  // ===== BME280 =====
  g_temperture = bme.readTemperature();
  g_humidity   = bme.readHumidity();
  g_pressure   = bme.readPressure() / 100.0;

  // فلترة NaN
  if (isnan(g_temperture))
    g_temperture = 0;

  if (isnan(g_humidity))
    g_humidity = 0;

  if (isnan(g_pressure))
    g_pressure = 0;


  // ===== Wind Direction =====
  int D_adc = analogRead(WIND_DIR_PIN);

  if (D_adc < 0 || D_adc > 4095)
    D_adc = 0;

  g_windD = getWindDirection(D_adc);


  // ===== Wind Speed =====
  int S_adc = analogRead(WIND_SPEED_PIN);

  float S_voltage = S_adc * (3.3 / 4095.0);

  if (S_voltage > minVoltage) {

    g_windS = (S_voltage - minVoltage) *
              (maxSpeed / (maxVoltage - minVoltage));

  } else {

    g_windS = 0;
  }

  if (g_windS < 0)
    g_windS = 0;


  // ===== Rain Sensor =====
  int rainState = digitalRead(RAIN_PIN);

  if (rainState == LOW) {

    g_rain = "rainy";

  } else {

    g_rain = "not rainy";
  }


  // ===== Send =====
  if (millis() - lastSend > SEND_INTERVAL) {

    lastSend = millis();

    sendToServer();
  }

  delay(200);
}


// ================= SEND ===================
void sendToServer() {

  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;

  http.begin(serverUrl);

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;

  doc["device_id"]  = dn;
  doc["temperture"] = g_temperture;
  doc["humidity"]   = g_humidity;
  doc["pressure"]   = g_pressure;
  doc["windS"]      = g_windS;
  doc["windD"]      = g_windD;
  doc["rain"]       = g_rain;

  String payload;

  serializeJson(doc, payload);

  int code = http.POST(payload);

  Serial.println(payload);
  Serial.printf("HTTP %d\n", code);

  http.end();
}
