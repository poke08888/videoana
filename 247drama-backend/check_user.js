const mongoose = require('mongoose');
const User = require('./models/user.model');
require('dotenv').config({ path: '/var/www/247drama/backend/.env' });

mongoose.connect(process.env.MongoDb_Connection_String).then(async () => {
  const user = await User.findOne({ _id: '6a62eb9a116137ff392b3734' });
  console.log('User coin info:', {
    coin: user.coin,
    rewardCoin: user.rewardCoin,
    purchasedCoin: user.purchasedCoin,
    ad: user.adRewardCoin,
    daily: user.dailyRewardCoin,
    login: user.loginRewardCoin
  });
  process.exit();
}).catch(console.error);
