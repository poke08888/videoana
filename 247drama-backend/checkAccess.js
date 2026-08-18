module.exports = () => {
  return (req, res, next) => {
    const key = req.headers.key || req.body.key || req.query.key;

    if (key) {
      if (key === process.env?.secretKey) {
        next();
      } else {
        return res.status(400).json({ status: false, error: "Unpermitted infiltration" });
      }
    } else {
      return res.status(400).json({ status: false, error: "Unpermitted infiltration" });
    }
  };
};
