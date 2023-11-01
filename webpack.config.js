'use strict';

const path = require('path');
const webpack = require('webpack');
const FileManagerPlugin = require('filemanager-webpack-plugin');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node',
  entry: './src/extension.ts',
  optimization: { 
    minimize: false
  },
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
    '@opentelemetry/tracing': '@opentelemetry/tracing'
  },
  plugins: [
    // Prevent webpack from trying to bundle electron, or require it as a direct dependency:
    // https://github.com/sindresorhus/got/issues/345#issuecomment-329939488
    new webpack.IgnorePlugin({ resourceRegExp: /^electron$/ }),
    new FileManagerPlugin({
      events: {
        onEnd: {
          copy: [
            {
              source: path.join(__dirname, 'node_modules', '@microsoft', 'vscode-azext-azureutils', 'resources', '**'),
              destination: path.join(__dirname, 'dist', 'node_modules', '@microsoft', 'vscode-azext-azureutils', 'resources')
            }
          ]
        }
      }
    })
  ],
  resolve: {
    extensions: ['.ts', '.js', '.json']
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
  },
  node: {
    __dirname: false,
    __filename: false,
  }
};
module.exports = config;