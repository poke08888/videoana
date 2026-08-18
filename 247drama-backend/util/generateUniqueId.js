const User = require("../models/user.model");

const generateUniqueId = async () => {
  const characters = "0123456789876543210";
  let uniqueId = "";
  const length = 8;

  let idExists = true;
  while (idExists) {
    uniqueId = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      uniqueId += characters[randomIndex];
    }

    const existingDoc = await User.findOne({ uniqueId });

    if (!existingDoc) {
      idExists = false;
    }
  }

  return uniqueId;
};

module.exports = { generateUniqueId };
