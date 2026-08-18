require('dotenv').config();
const mongoose = require('mongoose');
const MovieSeries = require('./models/movieSeries.model');

mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const movies = await MovieSeries.find().limit(5).lean();
    movies.forEach(m => console.log('Thumbnail:', m.thumbnail));
    process.exit(0);
  });
