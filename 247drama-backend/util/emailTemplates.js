const baseTemplate = (title, message) => {
    return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
              <td align="center">
                  <table width="600" cellpadding="0" cellspacing="0" 
                         style="background:#ffffff;margin-top:40px;padding:40px;border-radius:8px;">
                      
                      <tr>
                          <td align="center">
                              <h2 style="margin:0;color:#333;">${title}</h2>
                          </td>
                      </tr>

                      <tr>
                          <td style="padding:25px 0;color:#555;font-size:15px;line-height:1.6;">
                              ${message}
                          </td>
                      </tr>

                      <tr>
                          <td style="padding-top:20px;font-size:13px;color:#999;text-align:center;">
                              © ${new Date().getFullYear()} ${process.env.projectName}. All rights reserved.
                          </td>
                      </tr>

                  </table>
              </td>
          </tr>
      </table>
  </body>
  </html>
  `;
};

exports.subAdminCreatedTemplate = (name, email, password) =>
    baseTemplate(
        "Sub Admin Account Created Successfully",
        `
    Hello <b>${name}</b>,<br/><br/>

    Your Sub Admin account has been successfully created.<br/><br/>

    <b>Login Details:</b><br/>
    Email: <b>${email}</b><br/>
    Password: <b>${password}</b><br/><br/>

    You can now access the system using your registered email address and password.<br/><br/>

    We’re glad to have you on board.
    `
    );

exports.subAdminUpdatedTemplate = (name, email, password) =>
    baseTemplate(
        "Sub Admin Account Updated",
        `
    Hello <b>${name}</b>,<br/><br/>

    Your account information has been successfully updated.<br/><br/>

    <b>Updated Login Details:</b><br/>
    Email: <b>${email}</b><br/>
    Password: <b>${password}</b><br/><br/>

    Please use your updated credentials for future access.
    `
    );