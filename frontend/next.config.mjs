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
};

export default nextConfig;
