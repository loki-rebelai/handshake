module.exports = {
  apps: [
    {
      name: 'sw-mainnet',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
        ENV_FILE: '.env.mainnet',
        PORT: 3000,
      },
    },
    {
      name: 'sw-devnet',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
        ENV_FILE: '.env.devnet',
        PORT: 3001,
      },
    },
  ],
};
