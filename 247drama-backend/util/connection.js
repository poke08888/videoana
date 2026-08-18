//mongoose
const mongoose = require("mongoose");

mongoose.connect(process.env.MongoDb_Connection_String, {});

const db = mongoose.connection;

module.exports = db;
