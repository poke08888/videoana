require('dotenv').config();
const mongoose = require('mongoose');
const MovieSeries = require('./models/movieSeries.model');

mongoose.connect(process.env.MongoDb_Connection_String, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const movie = await MovieSeries.findOne({ name: 'Ba con trai tôi là ông trùm' }).lean();
    if (movie) {
      console.log('Movie found:', movie.name);
      console.log('Thumbnail:', movie.thumbnail);
      console.log('Banner:', movie.banner);
    } else {
      console.log('Movie not found');
    }
    process.exit(0);
  });
