const mongoose = require('mongoose');
const User = require('./models/user.model');
const ShortVideo = require('./models/shortVideo.model');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/admin_db').then(async () => {
  const video = await ShortVideo.findOne();
  console.log('Video cost:', video.coin);
  const user = await User.findOne({ coin: { $gt: 0 } });
  console.log('Sample User:', user);
  process.exit();
}).catch(console.error);
