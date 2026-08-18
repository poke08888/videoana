//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

//delete upload content from digital ocean storage
exports.deleteUploadContent = async (req, res) => {
  try {
    if (!req.body?.fileUrl) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    await deleteFromStorage(req.body?.fileUrl);

    return res.status(200).json({ status: true, message: "File deleted Successfully." });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

const getActiveStorage = async () => {
  const settings = settingJSON; // Replace this with actual settings loading logic if necessary

  if (settings.storage.local) return "local";
  if (settings.storage.awsS3) return "aws";
  if (settings.storage.digitalOcean) return "digitalocean";

  return "local"; // Fallback to local storage if no active storage is found
};

//upload content
exports.uploadContent = async (req, res) => {
  try {
    if (!req.body?.folderStructure) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    if (!req?.file) {
      return res.status(200).json({ status: false, message: "Please upload a valid files." });
    }

    let url = "";
    const activeStorage = await getActiveStorage();

    if (activeStorage === "local") {
      const baseUrl = process.env.baseURL || "http://103.179.185.196";
      url = `${baseUrl}/uploads/${req.file.originalname}`;
    } else if (activeStorage === "digitalocean") {
      url = `${settingJSON?.doEndpoint}/${req.body.folderStructure}/${req.file.originalname}`;
    } else if (activeStorage === "aws") {
      url = `${settingJSON.awsEndpoint}/${req.body.folderStructure}/${req.file.originalname}`;
    }

    return res.status(200).json({
      status: true,
      message: "File uploaded successfully",
      url,
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//upload multiple content
exports.uploadMultipleContent = async (req, res) => {
  try {
    const folderStructure = req.body?.folderStructure;

    if (!folderStructure) {
      return res.status(200).json({ status: false, message: "Oops! Invalid folder structure." });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(200).json({ status: false, message: "Please upload valid files." });
    }

    console.log("Multiple Upload started for admin side .......", req.files);

    const activeStorage = await getActiveStorage();
    const uploadedFiles = {};

    req.files.forEach((file) => {
      let fileUrl = "";

      if (activeStorage === "local") {
        const baseUrl = process.env.baseURL || "http://103.179.185.196";
        fileUrl = `${baseUrl}/uploads/${file.originalname}`;
      } else if (activeStorage === "digitalocean") {
        fileUrl = `${settingJSON?.doEndpoint}/${folderStructure}/${file.originalname}`;
      } else if (activeStorage === "aws") {
        fileUrl = `${settingJSON.awsEndpoint}/${folderStructure}/${file.originalname}`;
      }

      if (file.mimetype.startsWith("image/")) {
        uploadedFiles.videoImage = fileUrl;
      } else if (file.mimetype.startsWith("video/") || file.mimetype === "application/octet-stream") {
        uploadedFiles.videoUrl = fileUrl;
      }
    });

    if (!uploadedFiles.videoImage || !uploadedFiles.videoUrl) {
      return res.status(200).json({
        status: false,
        message: "Both video image and video file must be uploaded.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Files uploaded successfully.",
      data: uploadedFiles,
    });
  } catch (error) {
    console.log("Upload Error:", error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};
