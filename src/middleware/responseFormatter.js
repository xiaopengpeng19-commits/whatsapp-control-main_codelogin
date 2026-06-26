/**
 * Response formatter middleware
 * Formats all successful responses to a consistent structure
 */
async function responseFormatter(ctx, next) {
  await next();

  // Skip formatting for certain paths, content types and error responses
  if (
    ctx.path.startsWith('/api-docs') || // Skip Swagger UI routes
    ctx.path === '/swagger.json' ||     // Skip Swagger spec
    ctx.response.status < 200 ||
    ctx.response.status >= 300 ||
    ctx.response.type === 'application/octet-stream' ||
    ctx.response.type === 'text/event-stream' ||
    ctx.response.type === 'image/png' ||
    ctx.response.type === 'image/jpeg' ||
    ctx.response.type === 'text/html'
  ) {
    return;
  }

  // If response is already formatted, skip
  if (ctx.body && (ctx.body.success !== undefined)) {
    return;
  }

  // Format the response
  ctx.body = {
    success: true,
    data: ctx.body,
    timestamp: new Date().toISOString()
  };
}

module.exports = responseFormatter; 