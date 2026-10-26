import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@tallysync/contracts', '@tallysync/tally-core'],
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: { '/api/tally-sync/mapping': ['./config/**'], '/mapping': ['./config/**'] },
  output: 'standalone',
  webpack: (cfg) => {
    // workspace packages use NodeNext-style "./x.js" imports that point at .ts files
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  }
}
export default config
