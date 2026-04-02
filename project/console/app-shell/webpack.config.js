const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

module.exports = (config) => {
  config.plugins.push(
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
      filename: 'index.html',
      inject: 'body',
    })
  );

  // Set output publicPath for SPA routing.
  config.output.publicPath = '/console/';

  return config;
};
