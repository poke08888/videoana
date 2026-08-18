const MovieSeries = require("../../models/movieSeries.model");
const ShortVideo = require("../../models/shortVideo.model");

/**
 * GET /api/client/landing/movie?id=:movieId
 * Public endpoint – returns the minimal movie data needed to render a landing page.
 * No auth required.
 */
exports.getMovieLandingData = async (req, res) => {
  try {
    const { id, episode } = req.query;
    if (!id) {
      return res.status(400).json({ status: false, message: "Movie id is required" });
    }

    const movie = await MovieSeries.findById(id)
      .select("name description thumbnail banner isActive")
      .lean();

    if (!movie || !movie.isActive) {
      return res.status(404).json({ status: false, message: "Movie not found" });
    }

    let finalThumbnail = movie.thumbnail || movie.banner || "";
    if (finalThumbnail && (finalThumbnail.includes("103.179.185.196") || finalThumbnail.includes("localhost"))) {
      finalThumbnail = finalThumbnail.replace(/http:\/\/(103\.179\.185\.196|localhost)(:\d+)?/, "https://admin.247tv.app");
    } else if (finalThumbnail && !finalThumbnail.startsWith("http")) {
      const baseUrl = process.env.baseURL || "https://admin.247tv.app";
      finalThumbnail = finalThumbnail.startsWith("/")
        ? `${baseUrl}${finalThumbnail}`
        : `${baseUrl}/${finalThumbnail}`;
    }

    if (episode) {
      const episodeNum = parseInt(episode, 10);
      if (!isNaN(episodeNum)) {
        const episodeVideo = await ShortVideo.findOne({ movieSeries: id, episodeNumber: episodeNum }).lean();
        if (episodeVideo && episodeVideo.videoImage) {
          if (episodeVideo.videoImage.includes("103.179.185.196") || episodeVideo.videoImage.includes("localhost")) {
            finalThumbnail = episodeVideo.videoImage.replace(/http:\/\/(103\.179\.185\.196|localhost)(:\d+)?/, "https://admin.247tv.app");
          } else if (episodeVideo.videoImage.startsWith("http")) {
            finalThumbnail = episodeVideo.videoImage;
          } else {
            const baseUrl = process.env.baseURL || "https://admin.247tv.app";
            finalThumbnail = episodeVideo.videoImage.startsWith("/")
              ? `${baseUrl}${episodeVideo.videoImage}`
              : `${baseUrl}/${episodeVideo.videoImage}`;
          }
        }
      }
    }

    // Count total episodes for the Branch link metadata
    const totalVideos = await ShortVideo.countDocuments({ movieSeries: id, isActive: true });

    return res.status(200).json({
      status: true,
      data: {
        _id: id,
        name: movie.name,
        description: movie.description || "",
        thumbnail: finalThumbnail,
        totalVideos,
      },
    });
  } catch (err) {
    console.error("getMovieLandingData error:", err);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};
