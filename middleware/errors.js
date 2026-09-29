function notFound(req, res) {
  res.status(404).json({ message: 'Route not found.' });
}

function errorHandler(error, req, res, next) {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }

  const status = Number.isInteger(error.status) ? error.status : 500;
  const message = status === 500 ? 'An unexpected server error occurred.' : error.message;
  return res.status(status).json({ message });
}

module.exports = { notFound, errorHandler };
