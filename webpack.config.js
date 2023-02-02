//@ts-check

'use strict';

const path = require('path');
const copyWebpackPlugin = require('copy-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', 
	mode: 'none', 

  entry: './src/extension.ts', 
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
			path: require.resolve('path-browserify'),
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
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", 
  },
};
/** @type WebpackConfig */
const clientExtensionConfig = {
  target: "web",
  mode: "none",
  devtool: 'nosources-source-map',
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
  resolve: {
    extensions: ['.ts', ".js"]
  },
  entry: "./src/client/index.ts",
  output: {
    path: path.join(__dirname, "dist", "client"),
    filename: "client.js",
    libraryTarget: "umd",
  },
  plugins: [
    new copyWebpackPlugin({
      patterns: [
        {
          from: "node_modules/lamejs/lame.min.js",
          to: path.resolve(__dirname, "./dist")
        }
      ]
    })
  ]
};
module.exports = [ extensionConfig, clientExtensionConfig ];