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
      const uniqueName = `${file.originalname}`;
      cb(null, uniqueName);
    },
  }),

  digitalocean: multerS3({
    s3: digitalOceanS3,
    bucket: settingJSON.doBucketName,
    acl: "public-read",
    key: (req, file, cb) => {
      const folder = req.body.folderStructure || "uploads";
      const keyName = `${folder}/${file.originalname}`;
      cb(null, keyName);
    },
  }),

  aws: multerS3({
    s3: awsS3,
    bucket: settingJSON.awsBucketName,
    key: (req, file, cb) => {
      const folder = req.body.folderStructure || "uploads";
      const keyName = `${folder}/${file.originalname}`;
      cb(null, keyName);
    },
  }),
};

const getActiveStorage = async () => {
  const settings = settingJSON; // Assuming settingJSON holds the storage settings.
  if (settings.storage.local) return "local";
  if (settings.storage.awsS3) return "aws";
  if (settings.storage.digitalOcean) return "digitalocean";
  return "local"; // Default to local storage if no active storage is found
};

const getStorageType = async () => {
  const activeStorage = await getActiveStorage();
  return storageOptions[activeStorage];
};

const uploadMultipleMiddleware = async (req, res, next) => {
  const storage = await getStorageType();
  const upload = multer({
    storage: storage,
  }).array("content", 10);

  upload(req, res, next);
};

module.exports = uploadMultipleMiddleware;
