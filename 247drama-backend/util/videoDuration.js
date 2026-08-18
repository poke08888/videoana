const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const { PassThrough } = require("stream");

async function getVideoDuration(videoUrl) {
  try {
    const response = await axios({
      url: videoUrl,
      method: "GET",
      responseType: "stream",
      headers: {
        Range: "bytes=0-500000"
      },
      timeout: 8000
    });

    return new Promise((resolve) => {
      const stream = new PassThrough();
      response.data.pipe(stream);

      ffmpeg.ffprobe(stream, (err, metadata) => {
        if (err) return resolve(0);
        resolve(Math.floor(metadata?.format?.duration || 0));
      });
    });
  } catch (err) {
    return 0;
  }
}

module.exports = { getVideoDuration };