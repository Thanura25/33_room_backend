function notFoundMiddleware(request, response) {
  response.status(404).json({ message: `Route not found: ${request.method} ${request.originalUrl}` });
}

function errorMiddleware(error, _request, response, _next) {
  if (error.name === 'CastError') return response.status(400).json({ message: 'Invalid record ID or field value.' });
  if (error.type === 'entity.parse.failed') return response.status(400).json({ message: 'Invalid JSON request.' });
  if (error.code === 11000) {
    const fields = Object.keys(error.keyPattern || error.keyValue || {});
    if (fields.includes('phone_number')) return response.status(400).json({ message: 'This phone number is already assigned to another user.', field: 'phone_number' });
    if (fields.includes('email')) return response.status(400).json({ message: 'This email is already assigned to another user.', field: 'email' });
    return response.status(400).json({ message: 'This phone number, email or monthly bill already exists.' });
  }
  if (error.name === 'ValidationError') {
    const field = Object.keys(error.errors || {})[0];
    return response.status(400).json({ message: error.errors?.[field]?.message || error.message, ...(field ? { field } : {}) });
  }
  if (!error.statusCode || error.statusCode >= 500) console.error(error.message);
  return response.status(error.statusCode || 500).json({ message: error.message || 'Unexpected server error.', ...(error.field ? { field: error.field } : {}) });
}

module.exports = { errorMiddleware, notFoundMiddleware };
