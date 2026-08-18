const { S3Client } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const fs = require("fs");
const path = require("path");

const createS3Instance = (hostname, region, accessKeyId, secretAccessKey) => {
  return new S3Client({
    region: region || "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint: hostname.startsWith("http") ? hostname : `https://${hostname}`,
    forcePathStyle: true,
  });
};

const digitalOceanS3 = createS3Instance(settingJSON.doHostname, settingJSON.doRegion, settingJSON.doAccessKey, settingJSON.doSecretKey);

const awsS3 = createS3Instance(settingJSON.awsHostname, settingJSON.awsRegion, settingJSON.awsAccessKey, settingJSON.awsSecretKey);

const localStoragePath = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(localStoragePath)) {
  fs.mkdirSync(localStoragePath, { recursive: true });
}

const storageOptions = {
  local: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, localStoragePath);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    },
  }),

  digitalocean: multerS3({
    s3: digitalOceanS3,
    bucket: settingJSON.doBucketName,
    acl: "public-read",
    key: (req, file, cb) => {
      console.log("request body in uploadMiddleware :  ", req.body);

      const folder = req.body.folderStructure;
      cb(null, `${folder}/${file.originalname}`);
    },
  }),

  aws: multerS3({
    s3: awsS3,
    bucket: settingJSON.awsBucketName,
    key: (req, file, cb) => {
      const folder = req.body.folderStructure;
      cb(null, `${folder}/${file.originalname}`);
    },
  }),
};

const getActiveStorage = async () => {
  const settings = settingJSON;
  if (settings.storage.local) return "local";
  if (settings.storage.awsS3) return "aws";
  if (settings.storage.digitalOcean) return "digitalocean";
  return "local"; // Fallback to local storage if no storage is active
};

const uploadMiddleware = async (req, res, next) => {
  try {
    const activeStorage = await getActiveStorage(); // Dynamically fetch active storage

    multer({ storage: storageOptions[activeStorage] }).single("content")(req, res, next);
  } catch (error) {
    next(error); // Pass error to the error handler if any issue occurs
  }
};

module.exports = uploadMiddleware;
