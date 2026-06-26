const fs = require('fs');
const path = require('path');

// 直接读取swagger.json文件
const swaggerSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'swagger.json'), 'utf8')
);

module.exports = swaggerSpec; 