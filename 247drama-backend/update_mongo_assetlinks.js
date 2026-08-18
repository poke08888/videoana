require('dotenv').config();
const mongoose = require('mongoose');
const Setting = require('./models/setting.model');

const assetLinks = [
  {
    "relation": [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "com.nonelab.tv247",
      "sha256_cert_fingerprints": [
        "77:10:30:58:64:E2:7C:64:38:B2:F1:CD:4C:75:E9:C0:A4:00:B4:70:FE:75:7D:1B:30:5D:97:FF:AE:63:BE:BA",
        "30:66:E4:0D:2A:10:2E:93:2A:87:A2:F8:A7:95:4A:5F:D4:FE:5D:3D:1E:EC:0D:FA:59:71:BD:BA:D6:D1:0A:D0",
        "C4:16:8B:44:75:7B:65:11:61:69:F1:CF:55:6C:B3:55:2D:32:84:9D:3E:ED:81:9A:A2:BD:72:2D:9E:17:2C:0B",
        "B0:C0:C7:9E:D3:AD:38:14:DC:98:3D:4F:0D:22:A7:D8:ED:08:03:BC:F8:71:4A:6C:FD:DD:F1:FC:84:CB:F6:69"
      ]
    }
  }
];

mongoose.connect(process.env.MongoDb_Connection_String, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    await Setting.updateOne({}, { $set: { androidAssetLinks: assetLinks } });
    console.log('Successfully updated androidAssetLinks in MongoDB with the correct fingerprints');
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
