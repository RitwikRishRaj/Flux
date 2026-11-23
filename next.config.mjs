/** @type {import('next').NextConfig} */
const nextConfig = {
  // A static site: the Cloudflare Worker serves out/ and hosts the rooms (wrangler.jsonc "assets").
  output: "export",
  // Every room is one static page, /room; the Worker serves it for /room/<id>. This does the same in next dev only
  // (a static export can't have rewrites).
  ...(process.env.NODE_ENV === "development" && {
    async rewrites() {
      return [{ source: "/room/:id", destination: "/room" }];
    },
  }),
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
