export default async function handler(req, res) {
    try {
        // بغداد
        const latitude = 33.3152;
        const longitude = 44.3661;

        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant` +
            `&temperature_unit=celsius` +
            `&wind_speed_unit=ms` +
            `&precipitation_unit=mm` +
            `&timezone=Asia%2FBaghdad` +
            `&forecast_days=7`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `Open-Meteo error: ${response.status}`
            );
        }

        const data = await response.json();

        return res.status(200).json({
            success: true,
            timezone: data.timezone,
            hourly: data.hourly,
            daily: data.daily
        });

    } catch (error) {

        console.error("Forecast error:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
