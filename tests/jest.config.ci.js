const baseConfig = require('./jest.config');

module.exports = Object.assign({
  moduleNameMapper: {
    '^@/(.*)$': '../dist/$1'
  }
}, baseConfig);