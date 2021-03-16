//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'commonjs bufferutil',
    'spawn-sync': 'commonjs spawn-sync',
    'utf-8-validate': 'commonjs utf-8-validate',
    'applicationinsights-native-metrics': 'applicationinsights-native-metrics',
    '@opentelemetry/tracing': '@opentelemetry/tracing',
    'vscode-azureextensionui': 'vscode-azureextensionui'
  },
  plugins: [
      new webpack.IgnorePlugin(/^electron$/),
      new webpack.IgnorePlugin(/^\.\/locale$/, /handlebars$/)
  ],
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js', '.json'],
    alias: {
      'handlebars' : 'handlebars/dist/handlebars.js',
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  }
};
module.exports = config;