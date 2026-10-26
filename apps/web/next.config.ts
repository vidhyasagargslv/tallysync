import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@tallysync/contracts', '@tallysync/tally-core'],
  serverExternalPackages: ['better-sqlite3'],
  output: 'standalone',
  webpack: (cfg) => {
    // workspace packages use NodeNext-style "./x.js" imports that point at .ts files
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  }
}
export default config
