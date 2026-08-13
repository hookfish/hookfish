import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@hookfish/api', '@hookfish/provider', '@hookfish/sdk'],
}

export default nextConfig
