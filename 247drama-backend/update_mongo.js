const mongoose = require("mongoose");
const Setting = require("./models/setting.model");
require("dotenv").config({ path: ".env" });

const mongoURI = process.env.MongoDb_Connection_String || "mongodb://127.0.0.1:27017/storybox";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("Connected to MongoDB.");
    const setting = await Setting.findOne();
    if (setting) {
      setting.privacyPolicyLink = "http://103.179.185.196/privacy.html";
      setting.termsOfUsePolicyLink = "http://103.179.185.196/privacy.html";
      await setting.save();
      console.log("Setting updated successfully!");
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
