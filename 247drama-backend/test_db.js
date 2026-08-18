const mongoose = require('mongoose');
const MovieSeries = require('./models/movieSeries.model');
const ShortVideo = require('./models/shortVideo.model');
require('dotenv').config({ path: './.env' });

mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const movie = await MovieSeries.findOne().lean();
    console.log('Movie thumbnail:', movie ? movie.thumbnail : 'none');
    const shortVideo = await ShortVideo.findOne().lean();
    console.log('ShortVideo videoImage:', shortVideo ? shortVideo.videoImage : 'none');
    process.exit(0);
  });
