const mongoose = require('mongoose');
const ShortVideo = require('./models/shortVideo.model');
require('dotenv').config({ path: '/var/www/247drama/backend/.env' });

mongoose.connect(process.env.MongoDb_Connection_String).then(async () => {
  const videos = await ShortVideo.aggregate([
    { $group: { _id: '$coin', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  console.log('Video costs:', videos);
  process.exit();
}).catch(console.error);
