const baseConfig = require('./jest.config');

module.exports = Object.assign({
  moduleNameMapper: {
    '^template-replace-stream$': '../dist'
  }
}, baseConfig);