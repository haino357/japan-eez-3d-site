import type { NextConfig } from 'next';

const repositoryName = 'japan-eez-3d-site';
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix: isGitHubPagesBuild ? `/${repositoryName}/` : undefined,
};

export default nextConfig;
