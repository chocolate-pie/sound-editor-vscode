//@ts-check

"use strict";

const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: "node",
  mode: "none",

  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
    path: "commonjs path",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: `${pkg.displayName} v${pkg.version} (${pkg.license})`,
      entryOnly: true,
      raw: false,
    })
  ]
};
/** @type WebpackConfig */
const browserExtensionConfig = {
  mode: "none",
  target: "webworker",
  entry: "./src/extension.ts",
  output: {
    filename: "extension.js",
    path: path.join(__dirname, "./dist/web"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    fallback: {
      path: require.resolve("path-browserify"),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
    new webpack.BannerPlugin({
      banner: `${pkg.displayName} v${pkg.version} (${pkg.license})`,
      entryOnly: true,
      raw: false,
    })
  ],
};
/** @type WebpackConfig */
const clientExtensionConfig = {
  target: "web",
  mode: "none",
  devtool: "nosources-source-map",
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  entry: "./src/client/index.ts",
  output: {
    path: path.join(__dirname, "dist", "client"),
    filename: "client.js",
    libraryTarget: "umd",
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: `${pkg.displayName} v${pkg.version} (${pkg.license})`,
      entryOnly: true,
      raw: false,
    })
  ]
};
module.exports = [
  extensionConfig,
  browserExtensionConfig,
  clientExtensionConfig,
];
