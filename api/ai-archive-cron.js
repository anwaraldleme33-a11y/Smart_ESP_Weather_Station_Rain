import aiArchiveHandler from "./ai-archive.js";

export default async function handler(req, res) {

  // Vercel Cron يستخدم GET
  if (req.method !== "GET") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }

  // إجبار الأرشفة التلقائية على الجهاز max1
  req.query = {
    ...req.query,
    device: "max1"
  };

  return aiArchiveHandler(
    req,
    res
  );
}
