/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@moneycontrol/core",
    "@moneycontrol/db",
    "@moneycontrol/server",
  ],
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "drizzle-orm"],
  // The workspace packages (@moneycontrol/server, @moneycontrol/db) ship TS
  // source whose imports use the explicit `.js` extension required by NodeNext
  // resolution. Webpack 5 needs extensionAlias to map those back to .ts during
  // build. Turbopack handles this automatically.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
