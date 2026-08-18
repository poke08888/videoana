const { Resend } = require("resend");

let resendInstance = null;

const getResendInstance = () => {
  if (!resendInstance) {
    const apiKey = settingJSON?.resendApiKey;

    if (!apiKey) {
      console.error("❌ Resend API Key not found in settingJSON");
    }

    resendInstance = new Resend(apiKey);
    console.log("✅ Resend Initialized from settingJSON");
  }

  return resendInstance;
};

exports.sendEmail = async ({ to, subject, html }) => {
  try {
    const resend = getResendInstance();

    const response = await resend.emails.send({
      from: process.env.EMAIL,
      to,
      subject,
      html,
    });

    if (response?.error) {
      console.log(response.error.message);
    }

    return response;
  } catch (error) {
    console.log("Email Error:", error.message);
    throw error;
  }
};