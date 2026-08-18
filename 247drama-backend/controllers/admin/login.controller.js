const Login = require("../../models/login.model");

//get login or not
exports.fetchLoginOrNot = async (req, res) => {
  try {
    const login = await Login.findOne().lean();
    if (!login) {
      const newLogin = new Login();
      await newLogin.save();

      return res.status(200).json({ status: true, message: "Success", login: newLogin.login });
    } else {
      return res.status(200).json({ status: true, message: "Success", login: login.login });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
