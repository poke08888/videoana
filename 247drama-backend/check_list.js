const axios = require('axios');
axios.get('http://103.179.185.196/api/client/shortVideo/retrieveMovieSeriesVideosForUser?userId=6a71aecd6fc3a6e1151f6482&start=1&limit=100&movieSeriesId=6a6341835f4224e954e161fb', {headers:{key:'5TIvw5cpc0'}}).then(res => {
  const vid = res.data.data.videos.find(v => v._id === '6a63962efc55dd19943ff89b');
  console.log('Video in list:', vid);
}).catch(console.error);
