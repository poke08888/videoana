const express = require("express");
const route = express.Router();

const ShortVideoController = require("../../controllers/admin/shortVideo.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//validate whether an episode requires coins or not
route.get("/validateEpisodeLock", checkAccessWithSecretKey(), ShortVideoController.validateEpisodeLock);

//create shortVideo (movie or webseries wise)
route.post("/createShortVideo", checkAccessWithSecretKey(), ShortVideoController.createShortVideo);

//update movie or webseries
route.put("/updateShortVideo", checkAccessWithSecretKey(), ShortVideoController.updateShortVideo);

//fetch shortVideos
route.get("/fetchShortVideos", checkAccessWithSecretKey(), ShortVideoController.fetchShortVideos);

//fetch particular movie or webseries wise shortVideos
route.get("/retrieveMovieSeriesVideoData", checkAccessWithSecretKey(), ShortVideoController.retrieveMovieSeriesVideoData);

//fetching information about a short video
route.get("/getShortVideoInfo", checkAccessWithSecretKey(), ShortVideoController.getShortVideoInfo);

//handles moving an episode to a different position in the sequence and adjusts the episode numbers and lock status accordingly
route.patch("/editShortVideo", checkAccessWithSecretKey(), ShortVideoController.editShortVideo);

//delete a short video
route.delete("/removeShortMedia", checkAccessWithSecretKey(), ShortVideoController.removeShortMedia);

// Episodes Table Across All Series + Stats Cards (Episode Analytics)
route.get("/getEpisodesTableWithStats", checkAccessWithSecretKey(), ShortVideoController.getEpisodesTableWithStats);

// Episode Analytics Per Series (Episode Analytics)
route.get("/getEpisodeAnalyticsBySeries", checkAccessWithSecretKey(), ShortVideoController.getEpisodeAnalyticsBySeries);

module.exports = route;
