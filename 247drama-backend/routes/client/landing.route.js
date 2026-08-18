const express = require("express");
const route = express.Router();
const { getMovieLandingData } = require("../../controllers/client/landing.controller");

// GET /api/client/landing/movie?id=:movieId
// Public – no auth required
route.get("/movie", getMovieLandingData);

module.exports = route;
