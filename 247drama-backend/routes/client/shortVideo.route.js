const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const shortVideoController = require("../../controllers/client/shortVideo.controller");

//retrieves all videos from a specific movie series for a user (client)
route.get("/retrieveMovieSeriesVideosForUser", checkAccessWithSecretKey(), shortVideoController.retrieveMovieSeriesVideosForUser);

//retrieve only trailer with total counts short videos grouped by their associated movie series (for you)
route.get("/getVideosGroupedByMovieSeries", checkAccessWithSecretKey(), shortVideoController.getVideosGroupedByMovieSeries);

//create like or dislike for video
route.post("/likeOrDislikeOfVideo", checkAccessWithSecretKey(), shortVideoController.likeOrDislikeOfVideo);

//watch Ad for unlock video
route.patch("/viewAdToUnlockVideo", checkAccessWithSecretKey(), shortVideoController.viewAdToUnlockVideo);

//deducting coins when a video is viewed
route.patch("/deductCoinForVideoView", checkAccessWithSecretKey(), shortVideoController.deductCoinForVideoView);

//episodes auto-unlock (particular movieSeries wise)
route.patch("/unlockEpisodesAutomatically", checkAccessWithSecretKey(), shortVideoController.unlockEpisodesAutomatically);

//retrieves all videos from a specific movie series for a user (web)
route.get("/loadMovieSeriesVideosForUser", checkAccessWithSecretKey(), shortVideoController.loadMovieSeriesVideosForUser);

module.exports = route;
