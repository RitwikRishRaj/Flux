/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The /api/backend rewrite proxy aborts after 30 s by default, but one run-tests batch may take up to 60 s
    // (docs/run-tests) and the backend waits 70 s for it. Must stay above that, or long batches fail with a 500.
    proxyTimeout: 80_000,
  },
  webpack: (config, { isServer, webpack }) => {
    // Fix for monaco-editor in Next.js
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /vs\/nls\.messages-loader/,
      })
    );
    
    // Ignore y-monaco during SSR - it only works in browser
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('y-monaco');
    }
    
    return config;
  },
  async rewrites() {
    // Browser → Next → backend, so the API key never ships to the client.
    return [{ source: "/api/backend/:path*", destination: "http://localhost:8788/:path*" }];
  },
};

export default nextConfig;
