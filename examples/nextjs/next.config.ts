import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: [
    '@hookfish/api',
    '@hookfish/backend',
    '@hookfish/database',
    '@hookfish/provider',
    '@hookfish/provider-github',
    '@hookfish/provider-linear',
    '@hookfish/provider-notion',
    '@hookfish/providers',
  ],
}

export default nextConfig
