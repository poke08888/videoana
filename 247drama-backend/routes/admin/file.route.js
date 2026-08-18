//express
const express = require("express");
const route = express.Router();

//s3multer
const uploadMiddleware = require("../../util/uploadMiddleware");

//upload.js for multiple content
const uploadMultipleMiddleware = require("../../util/uploadMultipleMiddleware");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const FileController = require("../../controllers/admin/file.controller");

//upload content to digital ocean storage
route.post(
  "/upload-file",
  function (request, response, next) {
    uploadMiddleware(request, response, function (error) {
      if (error) {
        console.log("error in file ", error);
      } else {
        console.log("File uploaded successfully.");
        next();
      }
    });
  },
  checkAccessWithSecretKey(),
  FileController.uploadContent
);

//upload multiple content to digital ocean storage
route.post(
  "/upload_multiple_files",
  function (request, response, next) {
    uploadMultipleMiddleware(request, response, function (error) {
      if (error) {
        console.log("Error in file multipleUpload: ", error);
        return response.status(200).json({ status: false, message: error.message });
      } else {
        console.log("Multiple Files uploaded successfully.");
        next();
      }
    });
  },
  checkAccessWithSecretKey(),
  FileController.uploadMultipleContent
);

//delete upload content from digital ocean storage
route.delete("/delete-upload", checkAccessWithSecretKey(), FileController.deleteUploadContent);

module.exports = route;
