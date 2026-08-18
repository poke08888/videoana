require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/user.model');

mongoose.connect(process.env.MongoDb_Connection_String, { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
    const user = await User.findOne({ uniqueId: "15170712" });
    console.log("USER:", user);
    process.exit(0);
})
.catch(err => {
    console.log(err);
    process.exit(1);
});
