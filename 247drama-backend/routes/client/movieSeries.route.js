const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const movieSeriesController = require("../../controllers/client/movieSeries.controller");

//get movies or series (New Release) (home)
route.get("/fetchNewReleasesForUser", checkAccessWithSecretKey(), movieSeriesController.fetchNewReleasesForUser);

//contain categories with their respective movies or series (home)
route.get("/getMoviesGroupedByCategory", checkAccessWithSecretKey(), movieSeriesController.getMoviesGroupedByCategory);

//fetch all movies or web series that are trending (home)
route.get("/getTrendingMoviesSeries", checkAccessWithSecretKey(), movieSeriesController.getTrendingMoviesSeries);

//fetch movies or web series (home - banner is auto-animated) (client / web )
route.get("/fetchMoviesSeries", checkAccessWithSecretKey(), movieSeriesController.fetchMoviesSeries);

//search media content
route.get("/findContentBySearch", checkAccessWithSecretKey(), movieSeriesController.findContentBySearch);

//get most trending movies or series (Ranking) (based on most viewd)
route.get("/fetchTrendingMoviesSeries", checkAccessWithSecretKey(), movieSeriesController.fetchTrendingMoviesSeries);

//get filter wise movies or series
route.get("/getFilterContent", checkAccessWithSecretKey(), movieSeriesController.getFilterContent);

//get movies or series (New Release) (home) (web)
route.get("/fetchLatestContentForUser", checkAccessWithSecretKey(), movieSeriesController.fetchLatestContentForUser);

//contain categories with their respective movies or series (home) (web)
route.get("/fetchMoviesGroupedByGenre", checkAccessWithSecretKey(), movieSeriesController.fetchMoviesGroupedByGenre);

//fetch movies or web series (more recommended) (web)
route.get("/fetchMediaCollection", checkAccessWithSecretKey(), movieSeriesController.fetchMediaCollection);

//search media content (web)
route.get("/getContentBySearch", checkAccessWithSecretKey(), movieSeriesController.getContentBySearch);

module.exports = route;
