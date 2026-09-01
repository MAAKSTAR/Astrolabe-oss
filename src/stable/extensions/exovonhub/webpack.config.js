//@ts-check

'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: {
    extension: './src/extension.ts',
    VectorWorker: './src/brain/VectorWorker.ts',
    MotionWorker: './src/motion/MotionWorker.ts'
  },
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    'better-sqlite3': 'commonjs better-sqlite3',
    'sqlite-vec': 'commonjs sqlite-vec',
    '@xenova/transformers': 'commonjs @xenova/transformers',
    'onnxruntime-node': 'commonjs onnxruntime-node',
    'web-tree-sitter': 'commonjs web-tree-sitter',
    'typescript': 'commonjs typescript',
    'ts-morph': 'commonjs ts-morph',
    'node-llama-cpp': 'commonjs node-llama-cpp',
    '@exovon/core': 'commonjs @exovon/core',
    '@exovon/sdk': 'commonjs @exovon/sdk'
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.js', '.ts'],
      '.cjs': ['.cjs', '.cts'],
      '.mjs': ['.mjs', '.mts']
    }
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
    level: "log", // enables logging required for problem matchers
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
          to: 'wasm/[name][ext]'
        },
        {
          from: path.resolve(__dirname, 'node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm'),
          to: 'wasm/[name][ext]'
        },
        {
          from: path.resolve(__dirname, 'node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm'),
          to: 'wasm/[name][ext]'
        },
        {
          from: path.resolve(__dirname, 'node_modules/tree-sitter-python/tree-sitter-python.wasm'),
          to: 'wasm/[name][ext]'
        },
        {
          from: path.resolve(__dirname, 'webview-assets/astrolabe-motion-studio.js'),
          to: 'assets/[name][ext]'
        }
      ]
    })
  ]
};
module.exports = [ extensionConfig ];