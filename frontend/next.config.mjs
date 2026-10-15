/** @type {import('next').NextConfig} */
const nextConfig = {
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
    return [{ source: "/api/backend/:path*", destination: "http://localhost:8787/:path*" }];
  },
};

export default nextConfig;
