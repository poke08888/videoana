const mongoose = require('mongoose');
require('dotenv').config({ path: '/var/www/247drama/backend/.env' });

const updates = {
  en: {
    txtLinkEmail: "Link Email",
    txtEmailSubtitle: "Link your Google account",
    txtLinkPhoneNumber: "Link Phone Number",
    txtFollowYoutube: "Subscribe YouTube",
    txtYoutubeSubtitle: "Get rewarded for subscribing",
    txtSomeThingWentWrong: "Something went wrong",
    txtLinkFailed: "Link Failed"
  },
  vi: {
    txtLinkEmail: "Liên kết Email",
    txtEmailSubtitle: "Liên kết tài khoản Google",
    txtLinkPhoneNumber: "Liên kết SĐT",
    txtFollowYoutube: "Đăng ký YouTube",
    txtYoutubeSubtitle: "Nhận thưởng khi đăng ký",
    txtSomeThingWentWrong: "Đã có lỗi xảy ra",
    txtLinkFailed: "Liên kết thất bại"
  }
};

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Language = require('/var/www/247drama/backend/models/language.model');
  const langs = await Language.find();
  
  for (const lang of langs) {
    let changed = false;
    const updateKeys = updates[lang.languageCode];
    if (updateKeys) {
      for (const [k, v] of Object.entries(updateKeys)) {
        if (!lang.translations[k]) {
           lang.translations[k] = v;
           changed = true;
           console.log(`Added ${k}=${v} to ${lang.languageCode}`);
        }
      }
      if (changed) {
        lang.markModified('translations');
        await lang.save();
        console.log(`Saved ${lang.languageCode}`);
      }
    }
  }
  console.log("Done updating languages.");
  process.exit(0);
});
