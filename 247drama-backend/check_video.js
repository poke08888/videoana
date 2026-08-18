const mongoose = require('mongoose');
const ShortVideo = require('./models/shortVideo.model');
require('dotenv').config({ path: '/var/www/247drama/backend/.env' });

mongoose.connect(process.env.MongoDb_Connection_String).then(async () => {
  const video = await ShortVideo.findOne({ coin: { $gt: 0 } });
  console.log('Sample Video Cost:', video ? video.coin : 'No paid video found');
  process.exit();
}).catch(console.error);
