/** @type {import('next').NextConfig} */
const nextConfig = {
  // @moneycontrol/core ships TS source; let Next transpile it for the browser.
  transpilePackages: ["@moneycontrol/core"],
  reactStrictMode: true,
};

export default nextConfig;
