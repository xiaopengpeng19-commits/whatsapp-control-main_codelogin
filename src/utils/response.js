/**
 * Format API response
 * @param {boolean} success - Whether the request was successful
 * @param {string} message - Response message
 * @param {any} data - Response data
 * @returns {Object} - Formatted response
 */
function formatResponse(success, message, data = null) {
  return {
    success,
    message,
    data,
    timestamp: new Date()
  };
}

module.exports = {
  formatResponse
}; 